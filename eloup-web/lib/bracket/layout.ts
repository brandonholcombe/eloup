// Pure positioning for the visual bracket TREE (m8c3). Computes an (x,y) box for
// every node + connector edges, from the engine node graph — no DOM, so it's
// unit-testable. Rendered by components/Bracket.tsx as absolutely-positioned
// cards over an SVG connector layer.

import type { BracketNode } from '@/lib/bracket/engine';

export type NodeBox = { id: string; x: number; y: number; node: BracketNode };
export type Edge = { from: string; to: string; kind: 'winner' | 'loser' };
export type Layout = {
  boxes: NodeBox[];
  edges: Edge[];
  width: number;
  height: number;
  cardW: number;
  cardH: number;
};

// Tunable geometry (refined via screenshots).
export const CARD_W = 134;
export const CARD_H = 46;
const COL_STEP = CARD_W + 40; // horizontal distance between columns
const ROW = 58; // winners vertical unit (card + gap)
const BAND_GAP = 40; // gap between winners band and losers band

/**
 * Layout a double-elim bracket. Column: winners round r → 2*(r-1); losers round
 * r → r; grand → maxWbCol+1 (so WB drops land vertically over their LB target,
 * S1). Row: mean of a node's SAME-BAND winnerTo feeders (excluding the WB
 * dropper, B1); band round-1 nodes evenly spaced; grand = mean of the two finals.
 */
export function layoutBracket(nodes: BracketNode[]): Layout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Drop the inert grand-R2 reset node from the visual.
  const live = nodes.filter((n) => !(n.bracket === 'grand' && n.round === 2));
  const wbRounds = Math.max(...live.filter((n) => n.bracket === 'winners').map((n) => n.round));
  const lbRounds = Math.max(
    0,
    ...live.filter((n) => n.bracket === 'losers').map((n) => n.round),
  );
  const grandCol = 2 * (wbRounds - 1) + 1;

  const colOf = (n: BracketNode): number =>
    n.bracket === 'winners' ? 2 * (n.round - 1) : n.bracket === 'losers' ? n.round : grandCol;

  // Reverse of winnerTo, filtered to same-band feeders (the y-relevant ones).
  const feedersOf = new Map<string, string[]>();
  for (const n of live) {
    const t = n.winnerTo && byId.get(n.winnerTo.id);
    if (t && t.bracket === n.bracket) {
      const list = feedersOf.get(t.id) ?? [];
      list.push(n.id);
      feedersOf.set(t.id, list);
    }
  }

  const wbR1 = live.filter((n) => n.bracket === 'winners' && n.round === 1).length;
  const lbR1 = live.filter((n) => n.bracket === 'losers' && n.round === 1).length;
  const wbBandH = wbR1 * ROW;
  const lbOffset = wbBandH + BAND_GAP;
  // Stretch losers round-1 to span a comparable height to the winners band.
  const lbRow = lbR1 > 0 ? wbBandH / lbR1 : ROW;

  const yMemo = new Map<string, number>();
  const computeY = (n: BracketNode): number => {
    const cached = yMemo.get(n.id);
    if (cached !== undefined) return cached;
    let y: number;
    if (n.bracket === 'grand') {
      const wf = live.find((x) => x.bracket === 'winners' && x.round === wbRounds);
      const lf = live.find((x) => x.bracket === 'losers' && x.round === lbRounds);
      y = ((wf ? computeY(wf) : 0) + (lf ? computeY(lf) : 0)) / 2;
    } else {
      const feeders = (feedersOf.get(n.id) ?? []).map((id) => byId.get(id)!);
      if (feeders.length === 0) {
        y =
          n.bracket === 'winners'
            ? (n.position - 0.5) * ROW
            : lbOffset + (n.position - 0.5) * lbRow;
      } else {
        y = feeders.reduce((sum, f) => sum + computeY(f), 0) / feeders.length;
      }
    }
    yMemo.set(n.id, y);
    return y;
  };

  const boxes: NodeBox[] = live.map((n) => ({
    id: n.id,
    x: colOf(n) * COL_STEP,
    y: computeY(n),
    node: n,
  }));

  const edges: Edge[] = [];
  for (const n of live) {
    if (n.winnerTo && byId.get(n.winnerTo.id) && live.some((l) => l.id === n.winnerTo!.id)) {
      edges.push({ from: n.id, to: n.winnerTo.id, kind: 'winner' });
    }
    if (n.loserTo && byId.get(n.loserTo.id)) {
      edges.push({ from: n.id, to: n.loserTo.id, kind: 'loser' });
    }
  }

  const width = Math.max(...boxes.map((b) => b.x)) + CARD_W + 20;
  const height = Math.max(...boxes.map((b) => b.y)) + CARD_H + 20;
  return { boxes, edges, width, height, cardW: CARD_W, cardH: CARD_H };
}
