import { Card } from '@/components/ui/card';
import { BracketCard } from '@/components/BracketCard';
import { layoutBracket, type NodeBox } from '@/lib/bracket/layout';
import type { BracketNode } from '@/lib/bracket/engine';

// Visual double-elim bracket TREE (m8c3): rounds as columns forming the pyramid,
// SVG connector lines following winnerTo (solid, advance right) and loserTo
// (dashed, drop into losers), horizontally scrollable. Reporting stays inline:
// on a ready match an admin taps the winner's name (BracketCard).

function elbowH(sx: number, sy: number, tx: number, ty: number): string {
  const mx = (sx + tx) / 2;
  return `${sx},${sy} ${mx},${sy} ${mx},${ty} ${tx},${ty}`;
}
function elbowV(sx: number, sy: number, tx: number, ty: number): string {
  const my = (sy + ty) / 2;
  return `${sx},${sy} ${sx},${my} ${tx},${my} ${tx},${ty}`;
}

export function Bracket({
  nodes,
  nameOf,
  slug,
  viewerIsAdmin,
}: {
  nodes: BracketNode[];
  nameOf: (id: string) => string;
  slug: string;
  viewerIsAdmin: boolean;
}) {
  const L = layoutBracket(nodes);
  const boxById = new Map<string, NodeBox>(L.boxes.map((b) => [b.id, b]));
  const { cardW: W, cardH: H } = L;
  const gf = nodes.find((n) => n.id === 'grand-R1-M1');
  const champ = gf?.winner ?? null;

  return (
    <div>
      {champ && (
        <Card className="mb-3 border-blue-500 bg-blue-500/10 p-3 text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Champion</p>
          <p className="mt-1 text-lg font-semibold">🏆 {nameOf(champ)}</p>
        </Card>
      )}
      <p className="mb-2 text-xs text-muted-foreground">
        Double elimination · single grand final. Solid lines = winners advance,
        dashed = losers drop. Pan to explore ↔
      </p>
      {/* Fixed-height canvas that pans in both directions (its own page now). */}
      <div className="overflow-auto rounded-md border border-border h-[calc(100dvh-13rem)] bg-slate-950">
        <div className="relative" style={{ width: L.width, height: L.height }}>
          {/* Connector layer — MUST be pointer-events:none (B2) so cards stay tappable. */}
          <svg
            width={L.width}
            height={L.height}
            className="pointer-events-none absolute inset-0"
            aria-hidden
          >
            {L.edges.map((e, i) => {
              const s = boxById.get(e.from);
              const t = boxById.get(e.to);
              if (!s || !t) return null;
              const pts =
                e.kind === 'winner'
                  ? elbowH(s.x + W, s.y + H / 2, t.x, t.y + H / 2)
                  : elbowV(s.x + W / 2, s.y + H, t.x + W / 2, t.y);
              return (
                <polyline
                  key={i}
                  points={pts}
                  fill="none"
                  stroke={e.kind === 'winner' ? '#334155' : '#a16207'}
                  strokeWidth={e.kind === 'winner' ? 1.5 : 1}
                  strokeDasharray={e.kind === 'loser' ? '3 3' : undefined}
                />
              );
            })}
          </svg>
          {/* Match cards */}
          {L.boxes.map((b) => {
            const n = b.node;
            const done = n.status === 'done';
            return (
              <div key={b.id} className="absolute" style={{ left: b.x, top: b.y }}>
                <BracketCard
                  slug={slug}
                  nodeId={n.id}
                  width={W}
                  height={H}
                  status={n.status}
                  champion={n.id === 'grand-R1-M1' && !!champ}
                  canReport={viewerIsAdmin && n.status === 'ready' && !!n.p1 && !!n.p2}
                  p1={{
                    id: n.p1,
                    name: n.p1 ? nameOf(n.p1) : '',
                    isVoid: n.p1Void,
                    isWinner: done && n.winner === n.p1,
                  }}
                  p2={{
                    id: n.p2,
                    name: n.p2 ? nameOf(n.p2) : '',
                    isVoid: n.p2Void,
                    isWinner: done && n.winner === n.p2,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
