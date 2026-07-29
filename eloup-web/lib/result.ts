// Tailwind text-color classes for match result presentation (UX2 2c).
// Wins/positive delta green, losses/negative red, pending amber.

export function deltaColor(delta: number): string {
  return delta >= 0 ? 'text-emerald-400' : 'text-red-400';
}

export function statusColor(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'text-emerald-400';
    case 'pending':
      return 'text-amber-400';
    case 'disputed':
    case 'cancelled':
      return 'text-red-400';
    default:
      return 'text-muted-foreground';
  }
}
