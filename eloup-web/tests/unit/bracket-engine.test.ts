import { describe, expect, it } from 'vitest';
import {
  advanceWinner,
  champion,
  drawSize,
  generateBracket,
  seedOrder,
  type BracketNode,
} from '@/lib/bracket/engine';

const players = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`); // p1 = top seed

// Deterministic sim: better seed (lower index) always wins. p1 = seed 1.
function playOut(nodes: BracketNode[], rankOf: Map<string, number>): BracketNode[] {
  let guard = 0;
  for (;;) {
    if (guard++ > 10000) throw new Error('sim did not terminate');
    const ready = nodes.find((n) => n.status === 'ready');
    if (!ready) break;
    const w =
      rankOf.get(ready.p1!)! < rankOf.get(ready.p2!)! ? ready.p1! : ready.p2!;
    advanceWinner(nodes, ready.id, w);
  }
  return nodes;
}

function rankMap(ps: string[]): Map<string, number> {
  return new Map(ps.map((p, i) => [p, i]));
}

describe('seedOrder', () => {
  it('is the canonical 16-bracket order', () => {
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });
  it('is correct for 4 and 8', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe('drawSize', () => {
  it('rounds up to a power of 2 (min 4)', () => {
    expect(drawSize(2)).toBe(4);
    expect(drawSize(8)).toBe(8);
    expect(drawSize(9)).toBe(16);
    expect(drawSize(16)).toBe(16);
  });
});

describe('generateBracket structure (16-draw)', () => {
  const nodes = generateBracket(players(16));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  it('has 2N-2 competitive nodes + grand final (+ inert reset)', () => {
    // WB 15 + LB 14 + GF 1 = 30, plus the inert grand-R2 reset node.
    const competitive = nodes.filter((n) => n.id !== 'grand-R2-M1');
    expect(competitive.length).toBe(30);
    expect(byId.has('grand-R2-M1')).toBe(true);
  });

  it('B1: the winners-final LOSER drops to the losers final (LR6), not GF', () => {
    const wf = byId.get('winners-R4-M1')!;
    expect(wf.winnerTo).toEqual({ id: 'grand-R1-M1', slot: 1 }); // WB champ -> GF
    expect(wf.loserTo).toEqual({ id: 'losers-R6-M1', slot: 2 }); // runner-up -> LR6
  });

  it('LB final feeds the grand final; GF entrants are WB champ + LB champ', () => {
    expect(byId.get('losers-R6-M1')!.winnerTo).toEqual({ id: 'grand-R1-M1', slot: 2 });
  });
});

describe('full 16-player tournament (higher seed always wins)', () => {
  const ps = players(16);
  const nodes = playOut(generateBracket(ps), rankMap(ps));

  it('produces exactly one champion = the top seed', () => {
    expect(champion(nodes)).toBe('p1');
  });

  it('every non-champion is eliminated with exactly two losses', () => {
    const losses = new Map<string, number>();
    for (const n of nodes) {
      if (n.status === 'done' && n.winner) {
        const loser = n.winner === n.p1 ? n.p2 : n.p1;
        if (loser) losses.set(loser, (losses.get(loser) ?? 0) + 1);
      }
    }
    for (const p of ps) {
      if (p === 'p1') continue;
      expect(losses.get(p), `${p} losses`).toBe(2);
    }
  });
});

describe('bye cascade terminates and yields a champion', () => {
  for (const n of [9, 11, 13, 15]) {
    it(`${n} players (16-draw, ${16 - n} byes)`, () => {
      const ps = players(n);
      const nodes = playOut(generateBracket(ps), rankMap(ps));
      expect(champion(nodes)).toBe('p1');
      // No node left stuck 'ready'/'pending' with both real entrants.
      const stuck = nodes.filter(
        (x) => x.status === 'ready' && x.id !== 'grand-R2-M1',
      );
      expect(stuck).toEqual([]);
    });
  }

  it('a bye node advances its single real player with no opponent (no ELO signal)', () => {
    // 9 players: WR1 has 7 byes; seed-1 node auto-advances p1.
    const nodes = generateBracket(players(9));
    const wr1WithBye = nodes.filter(
      (n) => n.bracket === 'winners' && n.round === 1 && n.status === 'bye',
    );
    expect(wr1WithBye.length).toBe(7);
    for (const b of wr1WithBye) {
      // exactly one real entrant, recorded as the (walkover) winner
      const real = [b.p1, b.p2].filter((x) => x !== null);
      expect(real.length).toBe(1);
      expect(b.winner).toBe(real[0]);
    }
  });
});

describe('B3: no player faces a WB opponent in their FIRST losers match (anti-rematch cross)', () => {
  const ps = players(16);
  // Record each played node in order; track who beat/played whom, per bracket.
  const nodes = generateBracket(ps);
  const rankOf = rankMap(ps);
  const played: { bracket: string; round: number; position: number; a: string; b: string }[] = [];
  let guard = 0;
  for (;;) {
    if (guard++ > 10000) throw new Error('no terminate');
    const ready = nodes.find((n) => n.status === 'ready');
    if (!ready) break;
    played.push({
      bracket: ready.bracket,
      round: ready.round,
      position: ready.position,
      a: ready.p1!,
      b: ready.p2!,
    });
    const w = rankOf.get(ready.p1!)! < rankOf.get(ready.p2!)! ? ready.p1! : ready.p2!;
    advanceWinner(nodes, ready.id, w);
  }

  it('holds for a full higher-seed-wins run', () => {
    // WB opponents per player
    const wbOpp = new Map<string, Set<string>>();
    for (const m of played.filter((x) => x.bracket === 'winners')) {
      (wbOpp.get(m.a) ?? wbOpp.set(m.a, new Set()).get(m.a)!).add(m.b);
      (wbOpp.get(m.b) ?? wbOpp.set(m.b, new Set()).get(m.b)!).add(m.a);
    }
    // first LB match per player (earliest by round, then position). EXCLUDE the
    // losers FINAL (round 6): the WB runner-up drops there against the sole LB
    // survivor — a rematch is inherent (one match, no permutation freedom) and
    // is normal double-elim, not a cross defect. The anti-rematch cross is only
    // meaningful for the earlier drop rounds (LR2/LR4) that have freedom.
    const LOSERS_FINAL_ROUND = 6;
    const lb = played
      .filter((x) => x.bracket === 'losers' && x.round < LOSERS_FINAL_ROUND)
      .sort((x, y) => x.round - y.round || x.position - y.position);
    const firstLb = new Map<string, string>();
    for (const m of lb) {
      if (!firstLb.has(m.a)) firstLb.set(m.a, m.b);
      if (!firstLb.has(m.b)) firstLb.set(m.b, m.a);
    }
    for (const [p, opp] of firstLb) {
      expect(wbOpp.get(p)?.has(opp), `${p}'s first LB opp ${opp} was a WB opponent`).not.toBe(
        true,
      );
    }
  });
});

describe('smaller draws', () => {
  it('8-player is a valid 2N-2 = 14-match double-elim', () => {
    const ps = players(8);
    const gen = generateBracket(ps);
    const competitive = gen.filter((n) => n.id !== 'grand-R2-M1');
    expect(competitive.length).toBe(14);
    const nodes = playOut(gen, rankMap(ps));
    expect(champion(nodes)).toBe('p1');
  });
});
