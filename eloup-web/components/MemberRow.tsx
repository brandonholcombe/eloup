'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { TournamentMemberRow } from '@/lib/tournaments';

export function MemberRow({
  slug,
  member,
  viewerIsAdmin,
  isCreator,
}: {
  slug: string;
  member: TournamentMemberRow;
  viewerIsAdmin: boolean;
  isCreator: boolean;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isAdmin = !!member.is_admin;

  const call = (path: string, method: 'PUT' | 'DELETE') => {
    startTransition(async () => {
      setErr(null);
      const resp = await fetch(path, { method });
      if (!resp.ok) {
        setErr(await resp.text().catch(() => `error ${resp.status}`));
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-3">
        {member.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" src={member.avatar_url} className="h-8 w-8 rounded-full" />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-800 text-xs">
            {member.display_name.slice(0, 1)}
          </span>
        )}
        <div className="flex-1 truncate">
          <div className="truncate text-sm">{member.display_name}</div>
          {isAdmin && <div className="text-xs text-blue-400">admin{isCreator ? ' · creator' : ''}</div>}
        </div>
      </div>
      {viewerIsAdmin && (
        <div className="mt-2 flex flex-wrap gap-2">
          {!isAdmin && (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                call(`/api/tournaments/${slug}/admins/${member.player_id}`, 'PUT')
              }
              className="h-tap min-w-tap rounded-md bg-slate-700 px-3 text-xs text-white disabled:opacity-50"
            >
              Promote
            </button>
          )}
          {isAdmin && !isCreator && (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                call(`/api/tournaments/${slug}/admins/${member.player_id}`, 'DELETE')
              }
              className="h-tap min-w-tap rounded-md bg-slate-700 px-3 text-xs text-white disabled:opacity-50"
            >
              Demote
            </button>
          )}
          {!isCreator && (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                call(`/api/tournaments/${slug}/members/${member.player_id}`, 'DELETE')
              }
              className="h-tap min-w-tap rounded-md bg-slate-800 px-3 text-xs text-red-300 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      )}
      {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
    </li>
  );
}
