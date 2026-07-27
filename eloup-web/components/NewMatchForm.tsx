'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Game = {
  id: string;
  name: string;
  slug: string;
  format: '1v1' | 'team' | 'ffa';
  min_participants: number;
  max_participants: number;
};

type Player = { id: string; display_name: string; discord_handle: string };

type Tournament = {
  id: string;
  slug: string;
  name: string;
  members: Player[];
};

type Row = { playerId: string; placement: number; teamLabel: string };

export function NewMatchForm({
  games,
  players,
  viewerId,
  tournaments,
  defaultTournamentSlug,
}: {
  games: Game[];
  players: Player[];
  viewerId: string;
  tournaments: Tournament[];
  defaultTournamentSlug: string | null;
}) {
  const router = useRouter();
  const [gameId, setGameId] = useState(games[0]?.id ?? '');
  const game = useMemo(() => games.find((g) => g.id === gameId), [games, gameId]);
  const initialTournament = defaultTournamentSlug
    ? tournaments.find((t) => t.slug === defaultTournamentSlug) ?? null
    : null;
  const [tournamentId, setTournamentId] = useState<string>(initialTournament?.id ?? '');
  const tournament = useMemo(
    () => (tournamentId ? tournaments.find((t) => t.id === tournamentId) ?? null : null),
    [tournaments, tournamentId],
  );
  const eligiblePlayers = tournament ? tournament.members : players;
  const [rows, setRows] = useState<Row[]>([{ playerId: viewerId, placement: 1, teamLabel: 'A' }]);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const playerName = (id: string) =>
    eligiblePlayers.find((p) => p.id === id)?.display_name ?? '?';

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!game) return;
        setErr(null);
        startTransition(async () => {
          const resp = await fetch('/api/matches', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              gameId,
              tournamentId: tournamentId || null,
              participants: rows.map((r) => ({
                playerId: r.playerId,
                placement: Number(r.placement),
                teamLabel: game.format === 'team' ? r.teamLabel : null,
              })),
            }),
          });
          if (!resp.ok) {
            setErr(await resp.text().catch(() => `error ${resp.status}`));
            return;
          }
          const { id } = (await resp.json()) as { id: string };
          router.push(`/matches/${id}` as never);
        });
      }}
    >
      {tournaments.length > 0 && (
        <label className="block text-sm">
          Tournament (optional)
          <select
            value={tournamentId}
            onChange={(e) => {
              setTournamentId(e.target.value);
              setRows([{ playerId: viewerId, placement: 1, teamLabel: 'A' }]);
            }}
            className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2"
          >
            <option value="">— Casual match —</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block text-sm">
        Game
        <select
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2"
        >
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.format})
            </option>
          ))}
        </select>
      </label>

      <ol className="space-y-2">
        {rows.map((row, i) => (
          <li key={i} className="grid grid-cols-12 items-end gap-2">
            <label className="col-span-6 text-xs text-slate-400">
              Player
              <select
                value={row.playerId}
                onChange={(e) => updateRow(i, { playerId: e.target.value })}
                className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
              >
                {eligiblePlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-3 text-xs text-slate-400">
              Place
              <input
                type="number"
                min={1}
                value={row.placement}
                onChange={(e) => updateRow(i, { placement: Number(e.target.value) })}
                className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
              />
            </label>
            {game?.format === 'team' && (
              <label className="col-span-2 text-xs text-slate-400">
                Team
                <input
                  type="text"
                  value={row.teamLabel}
                  onChange={(e) => updateRow(i, { teamLabel: e.target.value.toUpperCase() })}
                  className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm uppercase"
                  maxLength={2}
                />
              </label>
            )}
            <button
              type="button"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              aria-label={`remove ${playerName(row.playerId)}`}
              className="col-span-1 h-tap rounded-md bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
            >
              ✕
            </button>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() =>
          setRows([
            ...rows,
            {
              playerId: eligiblePlayers[0]?.id ?? viewerId,
              placement: rows.length + 1,
              teamLabel: 'B',
            },
          ])
        }
        className="h-tap min-w-tap rounded-md bg-slate-800 px-3 text-sm text-slate-300 hover:bg-slate-700"
      >
        + Add participant
      </button>

      {game && (
        <p className="text-xs text-muted-foreground">
          {game.format} — needs {game.min_participants}–{game.max_participants} participants.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="h-tap min-w-tap w-full rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Submitting…' : 'Submit (pending confirmation)'}
      </button>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </form>
  );

  function updateRow(i: number, patch: Partial<Row>) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
}
