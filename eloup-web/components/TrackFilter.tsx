import Link from 'next/link';
import type { RcTrackRow } from '@/lib/db/rc';

export function TrackFilter({
  tracks,
  activeSlug,
}: {
  tracks: RcTrackRow[];
  activeSlug: string | null;
}) {
  return (
    <nav aria-label="Track filter" className="flex gap-2 overflow-x-auto pb-2">
      <Chip href="/racing" label="All" active={activeSlug === null} />
      {tracks.map((t) => (
        <Chip
          key={t.id}
          href={`/racing?track=${encodeURIComponent(t.slug)}`}
          label={t.name}
          active={activeSlug === t.slug}
        />
      ))}
    </nav>
  );
}

function Chip({ href, label, active }: { href: string; label: string; active: boolean }) {
  const cls =
    'h-tap min-w-tap whitespace-nowrap rounded-full px-4 py-1.5 text-sm ' +
    (active
      ? 'bg-blue-500 text-white'
      : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white');
  return (
    <Link href={href} className={cls}>
      {label}
    </Link>
  );
}
