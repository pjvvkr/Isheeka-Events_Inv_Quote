import { test, expect, Page } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Milestone S UI flow (staff side) ─────────────────────────────────────────
// Seeds a converted client RFQ + a submitted vendor bid directly in the LOCAL DB,
// then drives the real app UI: Sourcing panel → costing screen → validations →
// generate quote, plus the send-vendor-RFQ modal. The vendor PORTAL (rfq.html) is
// out of scope here (separate file + gateway SESSION_SECRET); the logic test
// (tests/flows/vendor-rfq-loop.test.ts) covers that data path.

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

function fromDotenv(key: string): string | undefined {
  try {
    const txt = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const m = txt.match(new RegExp('^' + key + '=(.*)$', 'm'));
    return m ? m[1].trim() : undefined;
  } catch { return undefined; }
}
const SB_URL = process.env.VITE_SUPABASE_URL || fromDotenv('VITE_SUPABASE_URL') || 'http://127.0.0.1:54321';
const SB_ANON = process.env.VITE_SUPABASE_ANON_KEY || fromDotenv('VITE_SUPABASE_ANON_KEY') || '';

async function login(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('you@isheeka.com').fill(EMAIL!);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 15_000 });
}

// Seed a converted client RFQ with two items, its draft quote, two vendors, and a
// SUBMITTED vendor bid (Stage ₹1000, Lighting "can't supply"). Returns the refs/names.
async function seed(sb: SupabaseClient, tag: string) {
  const now = new Date().toISOString();
  const { data: client } = await sb.from('clients').insert({ first_name: 'UITvrfq', last_name: tag }).select().single();
  const { data: quote } = await sb.from('quotations').insert({ ref_number: 'Q-UIT-' + tag, status: 'draft', client_id: client!.client_id, client_name: 'UITvrfq ' + tag, event_name: 'Wedding Event', doc_date: now.slice(0, 10), subtotal: 0, discount_amount: 0, grand_total: 0, payment_schedule: '[]', display_options: '{}', revision_number: 0, created_at: now, updated_at: now, is_deleted: false }).select().single();
  const { data: rfq } = await sb.from('rfqs').insert({ ref_number: 'R-UIT-' + tag, token_hash: 'uit-' + tag, status: 'converted', party_type: 'client', client_id: client!.client_id, quotation_id: quote!.quotation_id, contact_name: 'UITvrfq ' + tag, event_type: 'wedding', city: 'Hyderabad', created_at: now, updated_at: now, is_deleted: false }).select().single();
  await sb.from('rfq_items').insert([
    { rfq_id: rfq!.rfq_id, description: 'Stage', quantity: 1, sub_event_name: 'Reception', sort_order: 0 },
    { rfq_id: rfq!.rfq_id, description: 'Lighting', quantity: 2, sub_event_name: 'Reception', sort_order: 1 },
  ]);
  await sb.from('quotation_line_items').insert([
    { quotation_id: quote!.quotation_id, description: 'Stage', quantity: 1, unit_price: 0, amount: 0, sub_event_name: 'Reception', sort_order: 0 },
    { quotation_id: quote!.quotation_id, description: 'Lighting', quantity: 2, unit_price: 0, amount: 0, sub_event_name: 'Reception', sort_order: 1 },
  ]);
  const { data: vendorA } = await sb.from('vendors').insert({ name: 'UITvA ' + tag, phone_1: '+91 90000 00001', status: 'active' }).select().single();
  const { data: vendorB } = await sb.from('vendors').insert({ name: 'UITvB ' + tag, phone_1: '+91 90000 00002', status: 'active' }).select().single();
  const { data: vrfq } = await sb.from('rfqs').insert({ ref_number: 'RV-UIT-' + tag, token_hash: 'uitv-' + tag, status: 'submitted', party_type: 'vendor', parent_rfq_id: rfq!.rfq_id, vendor_id: vendorA!.vendor_id, event_type: 'wedding', city: 'Hyderabad', created_at: now, updated_at: now, is_deleted: false }).select().single();
  await sb.from('rfq_items').insert([
    { rfq_id: vrfq!.rfq_id, description: 'Stage', quantity: 1, sub_event_name: 'Reception', sort_order: 0, unit_cost: 1000, can_supply: true, item_note: 'incl setup' },
    { rfq_id: vrfq!.rfq_id, description: 'Lighting', quantity: 2, sub_event_name: 'Reception', sort_order: 1, can_supply: false },
  ]);
  return { rfqRef: rfq!.ref_number as string, vendorAName: vendorA!.name as string, vendorBName: vendorB!.name as string };
}

async function openSeededRfq(page: Page, rfqRef: string) {
  await page.locator('.nav-item', { hasText: 'RFQ' }).first().click();
  const row = page.getByText(rfqRef, { exact: true });
  await expect(row).toBeVisible({ timeout: 12_000 });
  await row.click();
  await expect(page.getByText('Sourcing — vendor RFQs')).toBeVisible({ timeout: 12_000 });
}

let sb: SupabaseClient;

test.beforeAll(async () => {
  test.skip(!EMAIL || !PASSWORD || !SB_ANON, 'Set E2E_EMAIL / E2E_PASSWORD and have a local anon key.');
  sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: EMAIL!, password: PASSWORD! });
});

test('Sourcing → costing → hard-block → in-house resolve → priced quote', async ({ page }) => {
  const tag = 'A' + Date.now();
  const { rfqRef, vendorAName } = await seed(sb, tag);
  const fatal: string[] = [];
  page.on('pageerror', (e) => fatal.push(e.message));

  await login(page);
  await openSeededRfq(page, rfqRef);

  // the submitted vendor shows on the panel
  await expect(page.getByText(vendorAName).first()).toBeVisible();
  await expect(page.getByText('Submitted').first()).toBeVisible();

  // into costing
  await page.getByRole('button', { name: /Open costing & markup/ }).click();
  await expect(page.getByText('Costing & markup').first()).toBeVisible({ timeout: 12_000 });
  // Stage: ₹1000 cost + 30% = ₹1,300 (proves the comparison + markup math render)
  await expect(page.getByText('₹1,300').first()).toBeVisible();

  // HARD BLOCK: Lighting has no vendor cost and isn't in-house yet
  await page.getByRole('button', { name: /Generate quote/ }).click();
  await expect(page.getByText('Fix these before generating')).toBeVisible();
  await expect(page.getByText(/no usable vendor cost/)).toBeVisible(); // the Lighting hard-block line
  await page.getByRole('button', { name: 'OK' }).click();

  // resolve Lighting in-house at ₹500 → client price ₹650 (×2 line = ₹1,300)
  const lightingRow = page.locator('tr', { hasText: 'Lighting' });
  await lightingRow.getByRole('checkbox').check();
  await lightingRow.getByPlaceholder('cost').fill('500');

  // generate → no soft warnings → lands on the priced quote (grand total 2,600)
  await page.getByRole('button', { name: /Generate quote/ }).click();
  await expect(page.getByText(/2,600/).first()).toBeVisible({ timeout: 12_000 });

  expect(fatal, 'no uncaught errors:\n' + fatal.join('\n')).toEqual([]);
});

test('Send vendor RFQ modal adds a vendor to the panel', async ({ page }) => {
  const tag = 'B' + Date.now();
  const { rfqRef, vendorBName } = await seed(sb, tag);

  await login(page);
  await openSeededRfq(page, rfqRef);

  await page.getByRole('button', { name: /Send vendor RFQ/ }).click();
  const modalRow = page.locator('label', { hasText: vendorBName });
  await expect(modalRow).toBeVisible({ timeout: 8_000 });
  await modalRow.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  // the new vendor appears in the list + the share-links block shows
  await expect(page.getByText('Share these links — the PIN is shown once')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(vendorBName).first()).toBeVisible();
});
