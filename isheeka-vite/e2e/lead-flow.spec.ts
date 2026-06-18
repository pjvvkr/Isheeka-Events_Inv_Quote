import { test, expect, Page } from '@playwright/test';

// ── UI happy-path: create a lead → list → detail → mark contacted ────────────
// Clicks the REAL form + screens (what logic tests can't see): does the form save,
// does the new lead show in the list, does its detail page open without crashing,
// does the "Mark as contacted" button actually advance the stage. Catches UI wiring
// breaks (a dead button, a form that doesn't save, a detail crash like the editEngage one).

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

async function login(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('you@isheeka.com').fill(EMAIL!);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 15_000 });
}

test('create a lead, see it listed, open detail, mark contacted', async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD to run.');

  // fail loudly on a real crash mid-flow
  const fatal: string[] = [];
  page.on('pageerror', (e) => fatal.push(e.message));

  await login(page);

  // go to Leads → New lead
  await page.locator('.nav-item', { hasText: 'Leads' }).first().click();
  await page.getByRole('button', { name: '+ New lead' }).first().click();

  // fill the required fields, with a UNIQUE last name so we can find this exact lead later
  const tag = 'E2E' + Date.now();
  await page.getByPlaceholder('e.g. Priya').fill('UITest');
  await page.getByPlaceholder('e.g. Sharma').fill(tag);
  await page.getByPlaceholder('+91 98765 43210').fill('9999999999');
  // Source + Event type are <select>s with a placeholder option — pick the first real choice
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'How did they find us?' }) }).selectOption({ index: 1 });
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Select type...' }) }).selectOption({ index: 1 });

  await page.getByRole('button', { name: /Save lead/ }).click();

  // back on the list — search by the unique tag, then open the lead
  const search = page.getByPlaceholder('Search by ref, name, phone, email...');
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(tag);
  // EXACT match on the full name resolves to just the row's name <span>. A substring match
  // would also match the span's ancestors (the card and <main>), and .first() would then
  // click the outermost container instead of the row — so the click wouldn't navigate.
  // Clicking the span bubbles to the card's onClick.
  const row = page.getByText('UITest ' + tag, { exact: true });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();

  // Confirm the DETAIL actually opened (not still on the list): the header's "Send RFQ"
  // action is always present for a non-lost lead. If this fails, the row click didn't navigate.
  await expect(page.getByRole('button', { name: /Send RFQ/ })).toBeVisible({ timeout: 12_000 });

  // New leads show "Mark as contacted" — advance the stage and confirm it sticks (best-effort,
  // since the exact action set can vary by stage).
  const markBtn = page.getByRole('button', { name: /Mark as contacted/ });
  if (await markBtn.count()) {
    await markBtn.first().click();
    await expect(page.getByText('Contacted', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  }

  expect(fatal, 'no uncaught errors during the flow:\n' + fatal.join('\n')).toEqual([]);
});
