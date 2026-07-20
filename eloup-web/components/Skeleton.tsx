// Lightweight loading skeleton primitives for route-level loading.tsx files.
// Dark-slate theme, animate-pulse, sized to the max-w-md mobile shell.

export function SkeletonBar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-800 ${className}`} />;
}

export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <ul className="mt-4 space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-3"
        >
          <SkeletonBar className="h-4 w-1/2" />
          <SkeletonBar className="h-4 w-10" />
        </li>
      ))}
    </ul>
  );
}

/** Full-page skeleton: a title bar + a list of shimmer rows, in the p-4 shell. */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <main className="p-4" aria-busy="true" aria-label="Loading">
      <SkeletonBar className="h-7 w-40" />
      <SkeletonRows count={rows} />
    </main>
  );
}
