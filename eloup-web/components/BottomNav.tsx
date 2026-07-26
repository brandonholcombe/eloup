import { LogIn } from 'lucide-react';
import { auth, signIn } from '@/lib/auth';
import { BottomNavItems } from '@/components/BottomNavItems';
import { Button } from '@/components/ui/button';

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
        <Button
          type="submit"
          variant="ghost"
          className="flex h-tap min-w-tap w-full flex-col items-center justify-center gap-0.5 text-xs text-slate-300 hover:bg-transparent hover:text-white"
        >
          <LogIn aria-hidden className="h-[22px] w-[22px]" />
          Sign in
        </Button>
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
      <BottomNavItems>{!signedIn && <SignInButton />}</BottomNavItems>
    </nav>
  );
}
