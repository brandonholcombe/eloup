'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

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

// Seed participant rows for a format. 1v1 pre-fills TWO rows (viewer + first
// distinct opponent — never the viewer twice); other formats start with just
// the viewer and the operator adds more.
function seedRows(
  format: Game['format'] | undefined,
  eligible: Player[],
  viewerId: string,
): Row[] {
  const viewerRow: Row = { playerId: viewerId, placement: 1, teamLabel: 'A' };
  if (format === '1v1') {
    const opponent = eligible.find((p) => p.id !== viewerId);
    return [
      viewerRow,
      { playerId: opponent?.id ?? '', placement: 2, teamLabel: 'B' },
    ];
  }
  return [viewerRow];
}

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
  const [rows, setRows] = useState<Row[]>(() =>
    seedRows(games[0]?.format, initialTournament ? initialTournament.members : players, viewerId),
  );
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Re-seed when the game (→ format) or tournament (→ eligible players) changes.
  // Fixes the prior bug where rows only reset on tournament change, so switching
  // to a 1v1 game never triggered the 2-row seed.
  useEffect(() => {
    setRows(seedRows(game?.format, eligiblePlayers, viewerId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, tournamentId]);

  const playerName = (id: string) =>
    eligiblePlayers.find((p) => p.id === id)?.display_name ?? '?';

  const is1v1 = game?.format === '1v1';

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
            onChange={(e) => setTournamentId(e.target.value)}
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

      {is1v1 ? (
        // 1v1 fast path: two players + a one-tap winner toggle (no number typing).
        <div className="space-y-3">
          {rows.map((row, i) => (
            <label key={i} className="block text-xs text-muted-foreground">
              {i === 0 ? 'Player 1' : 'Player 2'}
              <select
                value={row.playerId}
                onChange={(e) => updateRow(i, { playerId: e.target.value })}
                className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
              >
                <option value="">— select —</option>
                {eligiblePlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <fieldset>
            <legend className="text-xs text-muted-foreground">Who won?</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {rows.map((row, i) => (
                <Button
                  key={i}
                  type="button"
                  variant={row.placement === 1 ? 'default' : 'secondary'}
                  aria-pressed={row.placement === 1}
                  onClick={() => setWinner(i)}
                  className="h-tap w-full shadow-none"
                >
                  {row.playerId ? playerName(row.playerId) : i === 0 ? 'Player 1' : 'Player 2'}
                </Button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : (
        <>
          <ol className="space-y-2">
            {rows.map((row, i) => (
              <li key={i} className="grid grid-cols-12 items-end gap-2">
                <label className="col-span-6 text-xs text-muted-foreground">
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
                <label className="col-span-3 text-xs text-muted-foreground">
                  Place
                  <input
                    type="number"
                    inputMode="numeric"
                    enterKeyHint="done"
                    min={1}
                    max={rows.length}
                    value={row.placement}
                    onChange={(e) => updateRow(i, { placement: clampPlacement(e.target.value) })}
                    className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
                  />
                </label>
                {game?.format === 'team' && (
                  <label className="col-span-2 text-xs text-muted-foreground">
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
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  aria-label={`remove ${playerName(row.playerId)}`}
                  className="col-span-1 h-tap px-0 text-xs shadow-none"
                >
                  ✕
                </Button>
              </li>
            ))}
          </ol>

          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setRows([
                ...rows,
                {
                  playerId: nextUnusedPlayerId(),
                  placement: rows.length + 1,
                  teamLabel: 'B',
                },
              ])
            }
            className="h-tap min-w-tap px-3 text-sm shadow-none"
          >
            + Add participant
          </Button>
        </>
      )}

      {game && (
        <p className="text-xs text-muted-foreground">
          {game.format} — needs {game.min_participants}–{game.max_participants} participants.
        </p>
      )}

      <Button type="submit" disabled={isPending} className="h-tap w-full shadow-none">
        {isPending ? 'Submitting…' : 'Submit (pending confirmation)'}
      </Button>
      {err && (
        <p role="alert" className="text-xs text-red-400">
          {err}
        </p>
      )}
    </form>
  );

  function updateRow(i: number, patch: Partial<Row>) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  // 1v1 winner toggle: the tapped row places 1st, the other 2nd.
  function setWinner(i: number) {
    setRows(rows.map((r, j) => ({ ...r, placement: j === i ? 1 : 2 })));
  }

  // Clamp a placement input to [1, rows.length]; empty/invalid → 1 (never 0).
  function clampPlacement(raw: string): number {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return 1;
    return Math.max(1, Math.min(rows.length, n));
  }

  // First eligible player not already in a row (never re-adds the same player).
  function nextUnusedPlayerId(): string {
    const used = new Set(rows.map((r) => r.playerId));
    return eligiblePlayers.find((p) => !used.has(p.id))?.id ?? eligiblePlayers[0]?.id ?? viewerId;
  }
}
