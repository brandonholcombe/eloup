import { expect, test } from '@playwright/test';

// Smoke spec — covers the public surface only. Full sign-in → log match →
// confirm → leaderboard golden path requires a real Discord OAuth app or
// an Auth.js Credentials provider injected for tests, which is deferred.
// This spec gates the manifest, SW, health probe, and middleware redirect.

test('public surface smoke', async ({ page, request, baseURL }) => {
  const root = await page.goto('/');
  expect(root?.url()).toMatch(/\/leaderboards$/);
  await expect(page.getByRole('heading', { name: 'Leaderboards' })).toBeVisible();

  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true });

  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  const body = (await manifest.json()) as {
    display: string;
    start_url: string;
    icons: { purpose: string }[];
  };
  expect(body.display).toBe('standalone');
  expect(body.start_url).toBe('/leaderboards');
  const purposes = body.icons.map((i) => i.purpose);
  expect(purposes).toContain('any');
  expect(purposes).toContain('maskable');

  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain("request.mode === 'navigate'");
});

test('auth-gated routes redirect to sign-in when unauthenticated', async ({ page }) => {
  await page.goto('/matches');
  // Will redirect to /api/auth/signin; Auth.js may further redirect to Discord
  // or render its sign-in page. Either way, the URL is not /matches.
  await expect(page).not.toHaveURL(/\/matches$/);
});
