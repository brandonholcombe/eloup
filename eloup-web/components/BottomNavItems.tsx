'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Trophy, Car, Dices, Medal, User, type LucideIcon } from 'lucide-react';
import { isNavItemActive } from '@/lib/nav';

type NavItem = {
  href: '/leaderboards' | '/racing' | '/matches' | '/tournaments' | '/profile';
  label: string;
  Icon: LucideIcon;
};

// Nav items live in this client component (not passed from the server parent):
// a Lucide component can't cross the RSC boundary as a prop.
const ITEMS: NavItem[] = [
  { href: '/leaderboards', label: 'Boards', Icon: Trophy },
  { href: '/racing', label: 'Racing', Icon: Car },
  { href: '/matches', label: 'Matches', Icon: Dices },
  { href: '/tournaments', label: 'Cups', Icon: Medal },
  { href: '/profile', label: 'Me', Icon: User },
];

/**
 * Client half of the bottom nav: nav-item links with active-route highlighting
 * via usePathname(). The sign-in slot is passed in as `children` (composition)
 * so its inline 'use server' action stays server-side. See h8/ux0.
 */
export function BottomNavItems({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ul className="mx-auto flex max-w-md items-stretch justify-around gap-1 px-2 py-2">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = isNavItemActive(pathname, href);
        return (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-tap min-w-tap flex-col items-center justify-center gap-0.5 rounded-md text-xs ${
                active
                  ? 'bg-slate-800 font-medium text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Icon aria-hidden className="h-[22px] w-[22px]" />
              {label}
            </Link>
          </li>
        );
      })}
      {children}
    </ul>
  );
}
