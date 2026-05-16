import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { leaderboardForGame, listGames, overallLeaderboard } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const handle = db();
  const url = new URL(req.url);
  const tab = url.searchParams.get('tab') ?? 'overall';
  if (tab === 'overall') {
    return NextResponse.json({ tab, rows: overallLeaderboard(handle, 50) });
  }
  const games = listGames(handle);
  const g = games.find((x) => x.slug === tab);
  if (!g) return NextResponse.json({ tab, rows: [] });
  return NextResponse.json({ tab, rows: leaderboardForGame(handle, g.id, 50) });
}
