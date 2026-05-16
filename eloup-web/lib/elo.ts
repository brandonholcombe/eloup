// Pure ELO. No I/O. The apply layer (lib/db/match.ts) handles clamps,
// per-game vs overall semantics, and writes.

export type Format = '1v1' | 'team' | 'ffa';

export type Participant = {
  playerId: string;
  ratingBefore: number;
  teamLabel?: string;
};

export type Outcome = {
  playerId: string;
  placement: number;
};

export function computeMatchDeltas(
  participants: Participant[],
  outcomes: Outcome[],
  format: Format,
  k: number,
): Map<string, number> {
  if (format === '1v1') return delta1v1(participants, outcomes, k);
  if (format === 'team') return deltaTeam(participants, outcomes, k);
  return deltaFfa(participants, outcomes, k);
}

function expected(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

function scoreFromPlacement(pa: number, pb: number): { sa: number; sb: number } {
  if (pa < pb) return { sa: 1, sb: 0 };
  if (pa > pb) return { sa: 0, sb: 1 };
  return { sa: 0.5, sb: 0.5 };
}

function delta1v1(p: Participant[], o: Outcome[], k: number): Map<string, number> {
  if (p.length !== 2) throw new Error(`1v1 requires exactly 2 participants, got ${p.length}`);
  const [a, b] = p as [Participant, Participant];
  const oa = byId(o, a.playerId);
  const ob = byId(o, b.playerId);
  const { sa, sb } = scoreFromPlacement(oa.placement, ob.placement);
  const ea = expected(a.ratingBefore, b.ratingBefore);
  const eb = 1 - ea;
  const da = k * (sa - ea);
  const db = k * (sb - eb);
  return new Map([
    [a.playerId, da],
    [b.playerId, db],
  ]);
}

function deltaTeam(p: Participant[], o: Outcome[], k: number): Map<string, number> {
  const teams = new Map<string, Participant[]>();
  for (const m of p) {
    if (m.teamLabel == null) throw new Error(`team format requires teamLabel on every participant`);
    const list = teams.get(m.teamLabel) ?? [];
    list.push(m);
    teams.set(m.teamLabel, list);
  }
  if (teams.size !== 2) throw new Error(`team format requires exactly 2 teams, got ${teams.size}`);
  const [teamA, teamB] = [...teams.values()] as [Participant[], Participant[]];
  const avgA = avg(teamA.map((m) => m.ratingBefore));
  const avgB = avg(teamB.map((m) => m.ratingBefore));
  const placementA = byId(o, teamA[0]!.playerId).placement;
  const placementB = byId(o, teamB[0]!.playerId).placement;
  const { sa, sb } = scoreFromPlacement(placementA, placementB);
  const ea = expected(avgA, avgB);
  const eb = 1 - ea;
  const da = k * (sa - ea);
  const db = k * (sb - eb);
  const out = new Map<string, number>();
  for (const m of teamA) out.set(m.playerId, da);
  for (const m of teamB) out.set(m.playerId, db);
  return out;
}

function deltaFfa(p: Participant[], o: Outcome[], k: number): Map<string, number> {
  if (p.length < 2) throw new Error(`ffa requires at least 2 participants`);
  const kAdj = k / (p.length - 1);
  const out = new Map<string, number>();
  for (const m of p) out.set(m.playerId, 0);
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      const a = p[i]!;
      const b = p[j]!;
      const { sa, sb } = scoreFromPlacement(
        byId(o, a.playerId).placement,
        byId(o, b.playerId).placement,
      );
      const ea = expected(a.ratingBefore, b.ratingBefore);
      const eb = 1 - ea;
      out.set(a.playerId, out.get(a.playerId)! + kAdj * (sa - ea));
      out.set(b.playerId, out.get(b.playerId)! + kAdj * (sb - eb));
    }
  }
  return out;
}

function byId(o: Outcome[], id: string): Outcome {
  const hit = o.find((x) => x.playerId === id);
  if (!hit) throw new Error(`outcome missing for player ${id}`);
  return hit;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
