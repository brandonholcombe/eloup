import { auth, signIn } from '@/lib/auth';
import { BottomNavItems, type NavItem } from '@/components/BottomNavItems';

const ITEMS: NavItem[] = [
  { href: '/leaderboards', label: 'Boards', icon: '🏆' },
  { href: '/racing', label: 'Racing', icon: '🏎️' },
  { href: '/matches', label: 'Matches', icon: '🎲' },
  { href: '/tournaments', label: 'Cups', icon: '🏁' },
  { href: '/profile', label: 'Me', icon: '👤' },
];

// Stays a server component so its inline 'use server' action is valid. Rendered
// into the client BottomNavItems via composition (children slot) so it remains
// inside the flex <ul> layout without crossing into the client boundary.
function SignInButton() {
  return (
    <li className="flex-1">
      <form
        action={async () => {
          'use server';
          await signIn('discord', { redirectTo: '/leaderboards' });
        }}
      >
        <button
          type="submit"
          className="flex h-tap min-w-tap w-full flex-col items-center justify-center gap-0.5 text-xs text-slate-300 hover:text-white"
        >
          <span aria-hidden className="text-lg">🔑</span>
          Sign in
        </button>
      </form>
    </li>
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
      <BottomNavItems items={ITEMS}>
        {!signedIn && <SignInButton />}
      </BottomNavItems>
    </nav>
  );
}
