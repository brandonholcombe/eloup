import { Card } from '@/components/ui/card';
import { ReportBracketNode } from '@/components/ReportBracketNode';
import type { BracketNode } from '@/lib/bracket/engine';

function roundLabel(bracket: BracketNode['bracket'], round: number, maxWinners: number): string {
  if (bracket === 'grand') return 'Grand Final';
  if (bracket === 'winners') {
    if (round === maxWinners) return 'Winners Final';
    return `Winners — Round ${round}`;
  }
  return `Losers — Round ${round}`;
}

function Entrant({
  id,
  isVoid,
  isWinner,
  nameOf,
}: {
  id: string | null;
  isVoid: boolean;
  isWinner: boolean;
  nameOf: (id: string) => string;
}) {
  const label = id ? nameOf(id) : isVoid ? 'bye' : 'TBD';
  return (
    <span
      className={
        isWinner
          ? 'font-medium text-emerald-400'
          : id
            ? ''
            : 'text-muted-foreground'
      }
    >
      {label}
      {isWinner && ' ✓'}
    </span>
  );
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
  const maxWinners = Math.max(...nodes.filter((n) => n.bracket === 'winners').map((n) => n.round));
  const gf = nodes.find((n) => n.id === 'grand-R1-M1');
  const champ = gf?.winner ?? null;

  // Order: winners rounds, losers rounds, grand final. Skip the inert reset node.
  const order: BracketNode['bracket'][] = ['winners', 'losers', 'grand'];
  const groups: { key: string; label: string; nodes: BracketNode[] }[] = [];
  for (const b of order) {
    const rounds = [...new Set(nodes.filter((n) => n.bracket === b).map((n) => n.round))].sort(
      (a, z) => a - z,
    );
    for (const r of rounds) {
      if (b === 'grand' && r === 2) continue; // inert reset node
      const group = nodes
        .filter((n) => n.bracket === b && n.round === r)
        .sort((a, z) => a.position - z.position);
      groups.push({ key: `${b}-${r}`, label: roundLabel(b, r, maxWinners), nodes: group });
    }
  }

  return (
    <div className="space-y-5">
      {champ && (
        <Card className="border-blue-500 bg-blue-500/10 p-3 text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Champion</p>
          <p className="mt-1 text-lg font-semibold">🏆 {nameOf(champ)}</p>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Double elimination · single grand final (no bracket reset).
      </p>
      {groups.map((g) => (
        <section key={g.key}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {g.label}
          </h3>
          <ul className="space-y-2">
            {g.nodes.map((n) => {
              const done = n.status === 'done';
              return (
                <li key={n.id}>
                  <Card className="p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Entrant
                        id={n.p1}
                        isVoid={n.p1Void}
                        isWinner={done && n.winner === n.p1}
                        nameOf={nameOf}
                      />
                      <span className="text-xs text-muted-foreground">vs</span>
                      <Entrant
                        id={n.p2}
                        isVoid={n.p2Void}
                        isWinner={done && n.winner === n.p2}
                        nameOf={nameOf}
                      />
                    </div>
                    {n.status === 'bye' && (
                      <p className="mt-1 text-xs text-muted-foreground">bye — auto-advanced</p>
                    )}
                    {viewerIsAdmin && n.status === 'ready' && n.p1 && n.p2 && (
                      <ReportBracketNode
                        slug={slug}
                        nodeId={n.id}
                        p1={{ id: n.p1, name: nameOf(n.p1) }}
                        p2={{ id: n.p2, name: nameOf(n.p2) }}
                      />
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
