import { describe, expect, it } from 'vitest';
import { generateBracket } from '@/lib/bracket/engine';
import { CARD_H, layoutBracket } from '@/lib/bracket/layout';

const players = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('layoutBracket', () => {
  for (const n of [8, 13, 16]) {
    describe(`${n}-player draw`, () => {
      const nodes = generateBracket(players(n));
      const L = layoutBracket(nodes);
      const boxById = new Map(L.boxes.map((b) => [b.id, b]));

      it('places every live node (excludes the inert grand reset) with finite coords', () => {
        expect(L.boxes.length).toBe(nodes.length - 1); // minus grand-R2
        for (const b of L.boxes) {
          expect(Number.isFinite(b.x)).toBe(true);
          expect(Number.isFinite(b.y)).toBe(true);
        }
      });

      it('no two cards overlap (same column vertically separated by >= card height)', () => {
        const byCol = new Map<number, number[]>();
        for (const b of L.boxes) {
          const arr = byCol.get(b.x) ?? [];
          arr.push(b.y);
          byCol.set(b.x, arr);
        }
        for (const ys of byCol.values()) {
          ys.sort((a, z) => a - z);
          for (let i = 1; i < ys.length; i++) {
            expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(CARD_H);
          }
        }
      });

      it('a winners parent sits between its two same-band feeders (pyramid)', () => {
        for (const node of nodes) {
          if (node.bracket !== 'winners' || !node.winnerTo) continue;
          const target = node.winnerTo.id;
          // collect same-band winner feeders of `target`
          const feeders = nodes.filter(
            (x) => x.bracket === 'winners' && x.winnerTo?.id === target,
          );
          if (feeders.length !== 2) continue;
          const tBox = boxById.get(target);
          if (!tBox) continue;
          const fy = feeders.map((f) => boxById.get(f.id)!.y).sort((a, z) => a - z);
          expect(tBox.y).toBeGreaterThanOrEqual(fy[0]!);
          expect(tBox.y).toBeLessThanOrEqual(fy[1]!);
        }
      });

      it('losers band is below the winners band', () => {
        const wbMaxY = Math.max(
          ...L.boxes.filter((b) => b.node.bracket === 'winners').map((b) => b.y),
        );
        const lbMinY = Math.min(
          ...L.boxes.filter((b) => b.node.bracket === 'losers').map((b) => b.y),
        );
        expect(lbMinY).toBeGreaterThan(wbMaxY);
      });

      it('emits winner + loser edges only between live nodes', () => {
        for (const e of L.edges) {
          expect(boxById.has(e.from)).toBe(true);
          expect(boxById.has(e.to)).toBe(true);
        }
        expect(L.edges.some((e) => e.kind === 'winner')).toBe(true);
        expect(L.edges.some((e) => e.kind === 'loser')).toBe(true);
      });
    });
  }
});
