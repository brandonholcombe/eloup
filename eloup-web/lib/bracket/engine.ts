// Double-elimination bracket engine — PURE, in-memory (no DB), so the crux
// (generation + bye cascade + advancement) is exhaustively unit-testable.
// See Agents/TODO/Active/m8c-smash-double-elim.md. Guards the reviewer's bugs:
//   B1 WR-final loser drops to the losers final (not GF);
//   B2 a permanent bye is distinguishable from a not-yet-played feed;
//   S4 void-aware auto-advance recurses.

export type BracketId = 'winners' | 'losers' | 'grand';
export type NodeStatus = 'pending' | 'ready' | 'bye' | 'done';

export type BracketNode = {
  id: string; // `${bracket}-R${round}-M${position}`
  bracket: BracketId;
  round: number;
  position: number;
  p1: string | null; // resolved player id
  p2: string | null;
  p1Void: boolean; // this slot's feed is a permanent bye — will never arrive
  p2Void: boolean;
  winnerTo: { id: string; slot: 1 | 2 } | null;
  loserTo: { id: string; slot: 1 | 2 } | null;
  status: NodeStatus;
  winner: string | null;
};

const BYE = '__bye__';

/** Standard bracket seed order for a power-of-2 size (recursive mirror). */
export function seedOrder(size: number): number[] {
  let pls = [1, 2];
  const rounds = Math.log2(size);
  for (let r = 1; r < rounds; r++) {
    const sum = pls.length * 2 + 1;
    const out: number[] = [];
    for (const p of pls) {
      out.push(p, sum - p);
    }
    pls = out;
  }
  return pls;
}

/** Smallest power-of-2 draw that holds n entrants (min 4). */
export function drawSize(n: number): number {
  let s = 4;
  while (s < n) s *= 2;
  return s;
}

function nid(b: BracketId, r: number, p: number): string {
  return `${b}-R${r}-M${p}`;
}

/**
 * Build the fixed double-elimination structure (routing only) for a draw size,
 * then seed players and resolve byes. `playersBySeedRank[i]` is the player id
 * seeded at rank i+1 (best first); ranks beyond the list are byes.
 */
export function generateBracket(playersBySeedRank: string[]): BracketNode[] {
  const size = drawSize(playersBySeedRank.length);
  const wbRounds = Math.log2(size); // e.g. 16 -> 4
  const lbRounds = 2 * (wbRounds - 1); // e.g. 16 -> 6
  const nodes = new Map<string, BracketNode>();

  const mk = (b: BracketId, r: number, p: number): BracketNode => {
    const node: BracketNode = {
      id: nid(b, r, p),
      bracket: b,
      round: r,
      position: p,
      p1: null,
      p2: null,
      p1Void: false,
      p2Void: false,
      winnerTo: null,
      loserTo: null,
      status: 'pending',
      winner: null,
    };
    nodes.set(node.id, node);
    return node;
  };

  // ---- Winners bracket nodes ----
  for (let r = 1; r <= wbRounds; r++) {
    const count = size / 2 ** r;
    for (let p = 1; p <= count; p++) mk('winners', r, p);
  }
  // ---- Losers bracket nodes: rounds alternate major(recv WB drop)/minor ----
  // LB round match counts: LR1 = size/4, then pairs of equal rounds halving.
  const lbCounts: number[] = [];
  {
    let c = size / 4;
    for (let r = 1; r <= lbRounds; r++) {
      lbCounts[r] = c;
      if (r % 2 === 0) c = Math.max(1, c / 2); // halve after each minor round
    }
  }
  for (let r = 1; r <= lbRounds; r++) {
    for (let p = 1; p <= lbCounts[r]!; p++) mk('losers', r, p);
  }
  // ---- Grand final (+ inert reset node pre-allocated, unused in v1) ----
  mk('grand', 1, 1);
  mk('grand', 2, 1); // reset node — inert in v1

  // ---- Winners routing ----
  for (let r = 1; r < wbRounds; r++) {
    const count = size / 2 ** r;
    for (let p = 1; p <= count; p++) {
      const n = nodes.get(nid('winners', r, p))!;
      const nextP = Math.ceil(p / 2);
      n.winnerTo = { id: nid('winners', r + 1, nextP), slot: p % 2 === 1 ? 1 : 2 };
    }
  }
  // WB final winner -> grand final slot 1
  nodes.get(nid('winners', wbRounds, 1))!.winnerTo = { id: nid('grand', 1, 1), slot: 1 };

  // ---- WB loser -> LB drop targets ----
  // WR1 loser -> LR1; WR_r (r>=2) loser -> LR(2r-2). Both are "major" rounds.
  for (let r = 1; r <= wbRounds; r++) {
    const count = size / 2 ** r;
    const lbRound = r === 1 ? 1 : 2 * r - 2;
    const lbCount = lbCounts[lbRound]!;
    for (let p = 1; p <= count; p++) {
      const n = nodes.get(nid('winners', r, p))!;
      if (r === 1) {
        // 2 WR1 losers per LR1 match; fill slot1 then slot2 across matches.
        const target = Math.ceil(p / 2);
        n.loserTo = { id: nid('losers', 1, target), slot: p % 2 === 1 ? 1 : 2 };
      } else {
        // One WB dropper per LB major-round match, into slot2 vs the LB
        // survivor. To avoid immediate WB rematches (B3), the cross ALTERNATES
        // per drop round: reverse for even WB rounds, straight for odd. A single
        // reverse everywhere leaves a residual correlation that reappears as a
        // rematch two LB rounds later (verified by the anti-rematch golden test).
        const reverse = r % 2 === 0;
        const target = reverse ? lbCount - ((p - 1) % lbCount) : ((p - 1) % lbCount) + 1;
        n.loserTo = { id: nid('losers', lbRound, target), slot: 2 };
      }
    }
  }

  // ---- Losers routing ----
  for (let r = 1; r <= lbRounds; r++) {
    const count = lbCounts[r]!;
    const isMinorNext = r % 2 === 1; // after a major(odd) round comes a minor merge
    for (let p = 1; p <= count; p++) {
      const n = nodes.get(nid('losers', r, p))!;
      if (r === lbRounds) {
        n.winnerTo = { id: nid('grand', 1, 1), slot: 2 }; // LB champion -> GF slot2
        continue;
      }
      const nextCount = lbCounts[r + 1]!;
      if (isMinorNext) {
        // odd LB round -> next round has same match count; winner keeps into slot1
        n.winnerTo = { id: nid('losers', r + 1, p), slot: 1 };
      } else {
        // even (minor) LB round -> merge two into one; winner into slot1
        const nextP = Math.ceil(p / 2);
        void nextCount;
        n.winnerTo = { id: nid('losers', r + 1, nextP), slot: p % 2 === 1 ? 1 : 2 };
      }
    }
  }

  // ---- Seed players into WR1 ----
  const order = seedOrder(size);
  const wr1 = size / 2;
  const playerForRank = (rank: number): string =>
    rank <= playersBySeedRank.length ? playersBySeedRank[rank - 1]! : BYE;
  for (let p = 1; p <= wr1; p++) {
    const n = nodes.get(nid('winners', 1, p))!;
    const s1 = order[(p - 1) * 2]!;
    const s2 = order[(p - 1) * 2 + 1]!;
    const a = playerForRank(s1);
    const b = playerForRank(s2);
    n.p1 = a === BYE ? null : a;
    n.p2 = b === BYE ? null : b;
    n.p1Void = a === BYE;
    n.p2Void = b === BYE;
  }

  const list = [...nodes.values()];
  resolveAll(list);
  return list;
}

/** Is a node ready to play (both real entrants present, not yet decided)? */
function computeStatus(n: BracketNode): NodeStatus {
  if (n.status === 'done') return 'done';
  const p1Known = n.p1 !== null || n.p1Void;
  const p2Known = n.p2 !== null || n.p2Void;
  if (!p1Known || !p2Known) return 'pending';
  // Both feeds resolved. If either side is a bye/void, this node is a walkover.
  if (n.p1Void || n.p2Void || n.p1 === null || n.p2 === null) return 'bye';
  return 'ready';
}

/**
 * Void-aware fixed-point resolver (B2/S4): auto-advance every bye/walkover node
 * (a node with one real player and a void/absent opponent), recursing until no
 * node changes. A node with BOTH feeds void produces no player and propagates
 * void onward.
 */
function resolveAll(nodes: BracketNode[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      if (n.status === 'done' || n.status === 'bye') continue;
      const st = computeStatus(n);
      if (st !== 'bye') {
        if (st !== n.status) {
          n.status = st;
          changed = true;
        }
        continue;
      }
      // Walkover: exactly one real player advances; if none, propagate void.
      const advancer = n.p1 ?? n.p2 ?? null;
      n.status = 'bye';
      n.winner = advancer;
      changed = true;
      if (n.winnerTo) writeInto(byId, n.winnerTo, advancer);
      if (n.loserTo) writeInto(byId, n.loserTo, null); // bye has no loser -> void
    }
  }
}

function writeInto(
  byId: Map<string, BracketNode>,
  ref: { id: string; slot: 1 | 2 },
  player: string | null,
): void {
  const t = byId.get(ref.id);
  if (!t) return;
  if (ref.slot === 1) {
    t.p1 = player;
    if (player === null) t.p1Void = true;
  } else {
    t.p2 = player;
    if (player === null) t.p2Void = true;
  }
}

/**
 * Record a played result: mark the node done, advance winner and loser, then
 * re-resolve byes (a dropped loser may land in a dead-sibling node). Mutates and
 * returns the node list. `nodeId` must currently be 'ready'.
 */
export function advanceWinner(
  nodes: BracketNode[],
  nodeId: string,
  winnerId: string,
): BracketNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const n = byId.get(nodeId);
  if (!n) throw new Error(`unknown node ${nodeId}`);
  if (computeStatus(n) !== 'ready') throw new Error(`node ${nodeId} not ready`);
  if (winnerId !== n.p1 && winnerId !== n.p2) {
    throw new Error(`winner ${winnerId} not in node ${nodeId}`);
  }
  const loserId = winnerId === n.p1 ? n.p2 : n.p1;
  n.winner = winnerId;
  n.status = 'done';
  if (n.winnerTo) writeInto(byId, n.winnerTo, winnerId);
  if (n.loserTo) writeInto(byId, n.loserTo, loserId);
  else void loserId; // eliminated
  resolveAll(nodes);
  return nodes;
}

/** The champion, if the grand final is decided. */
export function champion(nodes: BracketNode[]): string | null {
  const gf = nodes.find((n) => n.id === nid('grand', 1, 1));
  return gf?.winner ?? null;
}

export { BYE };
