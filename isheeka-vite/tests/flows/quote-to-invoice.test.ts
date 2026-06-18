import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { createInvoiceFromQuote } from '../../src/lib/money.js';

// ── Logic flow: confirmed quote → draft invoice ──────────────────────────────
// Drives the REAL createInvoiceFromQuote() against your local Supabase and checks
// the resulting invoice + line items + installments are exactly right. If the money
// math or a status drifts, the failing assertion names the exact value + step.
//
// Run (from isheeka-vite, with your local test login):
//   PowerShell:  $env:E2E_EMAIL="you@x.com"; $env:E2E_PASSWORD="…"; npm run test
// Points at whatever .env is set to — keep it on LOCAL.

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

const created: { table: string; col: string; id: any }[] = [];

describe('flow: confirmed quote → draft invoice', () => {
  beforeAll(async () => {
    if (!EMAIL || !PASSWORD) throw new Error('Set E2E_EMAIL and E2E_PASSWORD to run flow tests.');
    const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error('Login failed (is this user in your LOCAL Studio?): ' + error.message);
  });

  afterAll(async () => {
    // best-effort cleanup so reruns stay tidy — never fails the suite
    try {
      for (const id of created.filter((c) => c.table === 'invoices').map((c) => c.id)) {
        await supabase.from('invoice_installments').delete().eq('invoice_id', id);
        await supabase.from('invoice_line_items').delete().eq('invoice_id', id);
        await supabase.from('invoice_activity_log').delete().eq('invoice_id', id);
      }
      for (const id of created.filter((c) => c.table === 'quotations').map((c) => c.id)) {
        await supabase.from('quotation_line_items').delete().eq('quotation_id', id);
      }
      for (const { table, col, id } of [...created].reverse()) await supabase.from(table).delete().eq(col, id);
    } catch { /* throwaway local DB — ignore */ }
    await supabase.auth.signOut();
  });

  it('builds an invoice whose totals + installments exactly match the quote', async () => {
    // 1) client
    const { data: client, error: ce } = await supabase
      .from('clients').insert({ first_name: 'Test', last_name: 'Flow' }).select().single();
    expect(ce, 'insert client').toBeNull();
    created.push({ table: 'clients', col: 'client_id', id: client!.client_id });

    // 2) event
    const { data: event, error: ee } = await supabase
      .from('events').insert({ name: 'Flow Test Event', client_id: client!.client_id, client_name: 'Test Flow', status: 'planning' })
      .select().single();
    expect(ee, 'insert event').toBeNull();
    created.push({ table: 'events', col: 'event_id', id: event!.event_id });

    // 3) approved quotation — ₹1,00,000, no discount, two 50% installments
    const schedule = [
      { pct: 50, amount: 50000, label: 'Advance', when: 'On confirmation' },
      { pct: 50, amount: 50000, label: 'Balance', when: 'On event day' },
    ];
    const { data: quot, error: qe } = await supabase.from('quotations').insert({
      ref_number: 'Q-TEST-' + Date.now(),
      status: 'approved', client_id: client!.client_id, client_name: 'Test Flow',
      event_id: event!.event_id, event_name: 'Flow Test Event',
      subtotal: 100000, discount_amount: 0, grand_total: 100000,
      payment_schedule: JSON.stringify(schedule),
    }).select().single();
    expect(qe, 'insert quotation').toBeNull();
    created.push({ table: 'quotations', col: 'quotation_id', id: quot!.quotation_id });

    // 4) line items
    const { error: lie } = await supabase.from('quotation_line_items').insert([
      { quotation_id: quot!.quotation_id, description: 'Decoration', quantity: 1, unit_price: 100000, amount: 100000, sort_order: 0 },
    ]);
    expect(lie, 'insert quotation line items').toBeNull();

    // 5) ── function under test ──
    const inv: any = await createInvoiceFromQuote(quot!.quotation_id, { eventId: event!.event_id });
    expect(inv, 'createInvoiceFromQuote returned an invoice').toBeTruthy();
    created.push({ table: 'invoices', col: 'invoice_id', id: inv.invoice_id });

    // 6) ── exact assertions ──
    expect(inv.status, 'invoice status').toBe('draft');
    expect(Number(inv.subtotal), 'invoice subtotal').toBe(100000);
    expect(Number(inv.discount_amount), 'invoice discount').toBe(0);
    expect(Number(inv.grand_total), 'invoice grand total').toBe(100000);
    expect(Number(inv.total_outstanding), 'invoice outstanding').toBe(100000);
    expect(Number(inv.total_received), 'invoice received').toBe(0);

    const { data: ili } = await supabase.from('invoice_line_items').select('*').eq('invoice_id', inv.invoice_id);
    expect(ili?.length, 'invoice line items copied from quote').toBe(1);
    expect(Number(ili![0].amount), 'copied line item amount').toBe(100000);

    const { data: insts } = await supabase.from('invoice_installments')
      .select('*').eq('invoice_id', inv.invoice_id).order('installment_number');
    expect(insts?.length, 'installment count').toBe(2);
    const sum = (insts || []).reduce((s, p) => s + Number(p.amount_due), 0);
    expect(sum, 'installments must sum to the grand total').toBe(100000);
    expect(Number(insts![0].amount_due), 'advance installment amount').toBe(50000);
    expect(Number(insts![0].balance), 'advance balance equals amount due (unpaid)').toBe(50000);
  });
});
