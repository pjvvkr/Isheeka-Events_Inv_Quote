import { test, expect } from '@playwright/test';

// ── Smoke test ────────────────────────────────────────────────────────────────
// Logs in, then visits EVERY sidebar page and fails if any page blank-screens or
// throws a console/page error. This is the "did any change break a page?" check —
// run it after every change instead of re-clicking everything by hand.
//
// Run:  set credentials, then `npm run test:e2e`
//   PowerShell:  $env:E2E_EMAIL="you@isheeka.com"; $env:E2E_PASSWORD="…"; npm run test:e2e
//   cmd:         set E2E_EMAIL=you@isheeka.com&& set E2E_PASSWORD=…&& npm run test:e2e
//
// NOTE: this points at whatever Supabase your .env is configured for. Point it at a
// STAGING / throwaway database — not production — once that's set up.

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

// Sidebar labels to visit. (Users / Owner Account are intentional stubs — skipped.)
const PAGES = [
  'Dashboard', 'Leads', 'Client RFQ', 'Clients', 'Events',
  'Quotations', 'Invoices', 'Vendors', 'Vendor Payments',
  'Expenses', 'Reports', 'Settings',
];

test('every page renders without crashing', async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD env vars to run the smoke test.');

  const errors: string[] = [];
  // Only flag failures from OUR app / OUR Supabase — not best-effort external fetches
  // (e.g. the Google-Fonts CDN fetch in quotationPdf.js, which is try/catch'd and falls
  // back to a default font). Those aren't app bugs and shouldn't fail the smoke test.
  const isOurs = (url: string) =>
    url.includes('127.0.0.1:54321') || url.includes('localhost:5173') || url.startsWith('/');
  page.on('response', (r) => { if (r.status() >= 400 && isOurs(r.url())) errors.push(`[http ${r.status()}] ${r.url()}`); });
  page.on('requestfailed', (req) => {
    if (!isOurs(req.url())) return;
    const ft = req.failure()?.errorText || '';
    // A request the browser cancelled because we navigated to the next page before its
    // fetch finished — inherent to clicking through pages fast, not an app error.
    if (/ERR_ABORTED|ERR_CANCELED|aborted|canceled/i.test(ft)) return;
    errors.push(`[requestfailed] ${req.url()} — ${ft}`);
  });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // The generic "Failed to load resource" line carries no URL — the response/requestfailed
    // listeners above already capture those (with the URL + origin filter). Skip the noise.
    if (t.includes('Failed to load resource')) return;
    errors.push('[console.error] ' + t);
  });

  // ── Login ──
  await page.goto('/');
  await page.getByPlaceholder('you@isheeka.com').fill(EMAIL!);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 15_000 });

  // ── Walk every page ──
  for (const label of PAGES) {
    const before = errors.length;
    await page.locator('.nav-item', { hasText: label }).first().click();
    await expect(page.locator('.page-body')).toBeVisible();
    await page.waitForTimeout(900); // let data fetch + render settle
    const fresh = errors.slice(before);
    expect(fresh, `Errors while on the "${label}" page:\n${fresh.join('\n') || '(none)'}`).toEqual([]);
  }
});
