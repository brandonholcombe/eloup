export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > 0 ? base : 'tournament';
}

export function withSuffix(base: string, n: number): string {
  return n <= 1 ? base : `${base}-${n}`;
}
