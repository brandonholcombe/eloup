'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function CreateCupButton() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setErr(null);
        start(async () => {
          const resp = await fetch('/api/racing/cups', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          });
          if (!resp.ok) {
            setErr(await resp.text().catch(() => `error ${resp.status}`));
            return;
          }
          const { slug } = (await resp.json()) as { slug: string };
          router.push(`/racing/cups/${slug}` as never);
        });
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New cup name"
        className="h-tap flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
      />
      <Button type="submit" disabled={pending || !name.trim()} className="h-tap shadow-none">
        {pending ? '…' : 'Create'}
      </Button>
      {err && (
        <p role="alert" className="text-xs text-red-400">
          {err}
        </p>
      )}
    </form>
  );
}
