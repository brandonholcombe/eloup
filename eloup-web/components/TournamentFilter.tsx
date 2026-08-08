'use client';

import { useRouter, useSearchParams } from 'next/navigation';

// A <select> that filters a page by tournament via ?tournament=<slug>,
// preserving other query params (e.g. ?tab=). "All" clears the filter.
export function TournamentFilter({
  basePath,
  tournaments,
  active,
  allLabel = 'All',
}: {
  basePath: string;
  tournaments: { slug: string; name: string }[];
  active: string | null;
  allLabel?: string;
}) {
  const router = useRouter();
  const search = useSearchParams();

  return (
    <select
      aria-label="Filter by tournament"
      value={active ?? ''}
      onChange={(e) => {
        const params = new URLSearchParams(search.toString());
        if (e.target.value) params.set('tournament', e.target.value);
        else params.delete('tournament');
        const qs = params.toString();
        router.push((qs ? `${basePath}?${qs}` : basePath) as never);
      }}
      className="h-tap w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
    >
      <option value="">{allLabel}</option>
      {tournaments.map((t) => (
        <option key={t.slug} value={t.slug}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
