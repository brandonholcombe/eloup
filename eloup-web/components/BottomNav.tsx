import Link from 'next/link';
import { auth, signIn } from '@/lib/auth';

const ITEMS: {
  href: '/leaderboards' | '/matches' | '/tournaments' | '/profile';
  label: string;
  icon: string;
}[] = [
  { href: '/leaderboards', label: 'Boards', icon: '🏆' },
  { href: '/matches', label: 'Matches', icon: '🎲' },
  { href: '/tournaments', label: 'Cups', icon: '🏁' },
  { href: '/profile', label: 'Me', icon: '👤' },
];

async function SignInButton() {
  return (
    <form
      action={async () => {
        'use server';
        await signIn('discord', { redirectTo: '/leaderboards' });
      }}
    >
      <button
        type="submit"
        className="flex h-tap min-w-tap flex-col items-center justify-center gap-0.5 text-xs text-slate-300 hover:text-white"
      >
        <span aria-hidden className="text-lg">🔑</span>
        Sign in
      </button>
    </form>
  );
}

export async function BottomNav() {
  const session = await auth();
  const signedIn = !!session?.user;
  return (
    <nav
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur"
      style={{ paddingBottom: 'var(--safe-bottom, 0px)' }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around gap-1 px-2 py-2">
        {ITEMS.map((it) => (
          <li key={it.href} className="flex-1">
            <Link
              href={it.href}
              className="flex h-tap min-w-tap flex-col items-center justify-center gap-0.5 rounded-md text-xs text-slate-300 hover:text-white"
            >
              <span aria-hidden className="text-lg">
                {it.icon}
              </span>
              {it.label}
            </Link>
          </li>
        ))}
        {!signedIn && (
          <li className="flex-1">
            <SignInButton />
          </li>
        )}
      </ul>
    </nav>
  );
}
