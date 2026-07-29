// Podium medal for ranks 1-3, else null (caller falls back to the number).
// Emoji is intentional here — celebratory party flair; the icon convention
// reserves inline-SVG (Lucide) for nav + controls, not decorative rank tags.
export function rankMedal(rank: number): string | null {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
}
