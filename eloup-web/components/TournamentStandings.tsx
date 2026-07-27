import type { StandingsRow } from '@/lib/tournament-standings';

export function TournamentStandings({
  rows,
  viewerId,
}: {
  rows: StandingsRow[];
  viewerId: string;
}) {
  if (rows.length === 0) {
    return <p className="mt-2 text-slate-400">No members yet.</p>;
  }
  return (
    <ol className="mt-2 space-y-2">
      {rows.map((r, i) => {
        const isViewer = r.player_id === viewerId;
        return (
          <li
            key={r.player_id}
            className={
              'flex items-center gap-3 rounded-md border px-3 py-2 ' +
              (isViewer
                ? 'border-blue-500 bg-card'
                : 'border-border bg-card')
            }
          >
            <span className="w-6 text-right text-muted-foreground">{i + 1}</span>
            {r.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={r.avatar_url} className="h-8 w-8 rounded-full" />
            ) : (
              <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-800 text-xs">
                {r.display_name.slice(0, 1)}
              </span>
            )}
            <div className="flex-1 truncate">
              <div className="truncate text-sm">{r.display_name}</div>
              <div className="text-xs text-muted-foreground">
                {r.wins}W · {r.matches_played - r.wins}L · {r.matches_played} played
              </div>
            </div>
            <span className="font-mono text-sm tabular-nums text-slate-300">
              {r.overall_rating == null ? '—' : Math.round(r.overall_rating)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
