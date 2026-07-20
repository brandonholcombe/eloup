// Lightweight loading skeleton composites for route-level loading.tsx files.
// Built on the shared ui/skeleton primitive; sized to the max-w-md mobile shell.
import { Skeleton } from '@/components/ui/skeleton';

export function SkeletonBar({ className = '' }: { className?: string }) {
  return <Skeleton className={className} />;
}

export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <ul className="mt-4 space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-3"
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
