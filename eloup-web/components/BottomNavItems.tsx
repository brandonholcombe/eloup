'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavItemActive } from '@/lib/nav';

export type NavItem = {
  href: '/leaderboards' | '/racing' | '/matches' | '/tournaments' | '/profile';
  label: string;
  icon: string;
};

/**
 * Client half of the bottom nav: renders the nav-item links with active-route
 * highlighting via usePathname(). The sign-in slot is passed in as `children`
 * (React composition) so its inline 'use server' action stays server-side —
 * it cannot be defined inside this client boundary. See h8-mobile-ux-hardening.
 */
export function BottomNavItems({
  items,
  children,
}: {
  items: NavItem[];
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <ul className="mx-auto flex max-w-md items-stretch justify-around gap-1 px-2 py-2">
      {items.map((it) => {
        const active = isNavItemActive(pathname, it.href);
        return (
          <li key={it.href} className="flex-1">
            <Link
              href={it.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-tap min-w-tap flex-col items-center justify-center gap-0.5 rounded-md text-xs ${
                active
                  ? 'bg-slate-800 font-medium text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <span aria-hidden className="text-lg">
                {it.icon}
              </span>
              {it.label}
            </Link>
          </li>
        );
      })}
      {children}
    </ul>
  );
}
