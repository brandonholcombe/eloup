'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function CreateBracketButton({ slug, memberCount }: { slug: string; memberCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <Button
        type="button"
        disabled={pending || memberCount < 2}
        onClick={() => {
          if (
            !window.confirm(
              `Generate a double-elimination bracket for ${memberCount} members, seeded by ELO? Members can't change after a result is reported.`,
            )
          )
            return;
          setErr(null);
          start(async () => {
            const resp = await fetch(`/api/tournaments/${slug}/bracket`, { method: 'POST' });
            if (!resp.ok) {
              setErr(await resp.text().catch(() => `error ${resp.status}`));
              return;
            }
            router.refresh();
          });
        }}
        className="h-tap w-full shadow-none"
      >
        {pending ? 'Generating…' : 'Generate bracket'}
      </Button>
      {memberCount < 2 && (
        <p className="mt-1 text-xs text-muted-foreground">Need at least 2 members.</p>
      )}
      {err && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {err}
        </p>
      )}
    </div>
  );
}
