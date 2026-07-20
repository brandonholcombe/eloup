/**
 * Whether a bottom-nav tab should render as active for the current pathname.
 * A tab is active on its exact route and on any sub-route (so /matches/[id]
 * lights the Matches tab). Nav hrefs never include '/', so there is no
 * "matches everything" case. See h8-mobile-ux-hardening.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
