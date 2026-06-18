import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { createInvoiceFromQuote, reconcileInvoiceInstallments } from '../../src/lib/money.js';

// ── Edge: overpayment ────────────────────────────────────────────────────────
// Reconciling MORE than the grand total must cap each installment at its amount_due
// (no installment shows amount_paid > due, no negative balance, no error).

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const created: { table: string; col: string; id: any }[] = [];

describe('edge: overpayment caps each installment', () => {
  beforeAll(async () => {
    if (!EMAIL || !PASSWORD) throw new Error('Set E2E_EMAIL and E2E_PASSWORD to run flow tests.');
    const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error('Login failed (is this user in your LOCAL Studio?): ' + error.message);
  });

  afterAll(async () => {
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

  it('reconciling ₹1,20,000 against a ₹1,00,000 invoice caps both installments at ₹50,000', async () => {
    const { data: client } = await supabase.from('clients').insert({ first_name: 'Over', last_name: 'Pay' }).select().single();
    created.push({ table: 'clients', col: 'client_id', id: client!.client_id });
    const { data: event } = await supabase.from('events').insert({ name: 'Overpay Event', client_id: client!.client_id, client_name: 'Over Pay', status: 'planning' }).select().single();
    created.push({ table: 'events', col: 'event_id', id: event!.event_id });
    const { data: quot } = await supabase.from('quotations').insert({
      ref_number: 'Q-OVER-' + Date.now(), status: 'approved', client_id: client!.client_id, client_name: 'Over Pay',
      event_id: event!.event_id, event_name: 'Overpay Event', subtotal: 100000, discount_amount: 0, grand_total: 100000,
      payment_schedule: JSON.stringify([{ pct: 50, amount: 50000 }, { pct: 50, amount: 50000 }]),
    }).select().single();
    created.push({ table: 'quotations', col: 'quotation_id', id: quot!.quotation_id });
    await supabase.from('quotation_line_items').insert([{ quotation_id: quot!.quotation_id, description: 'Decor', quantity: 1, unit_price: 100000, amount: 100000, sort_order: 0 }]);
    const inv: any = await createInvoiceFromQuote(quot!.quotation_id, { eventId: event!.event_id });
    created.push({ table: 'invoices', col: 'invoice_id', id: inv.invoice_id });

    const { data: before } = await supabase.from('invoice_installments').select('*').eq('invoice_id', inv.invoice_id).order('installment_number');
    await reconcileInvoiceInstallments(before || [], 120000); // ₹20,000 more than owed

    const { data: after } = await supabase.from('invoice_installments').select('*').eq('invoice_id', inv.invoice_id).order('installment_number');
    expect(after!.map((i) => Number(i.amount_paid)), 'each installment capped at its due, not the overpay').toEqual([50000, 50000]);
    expect(after!.every((i) => Number(i.balance) === 0), 'no negative balances').toBe(true);
    expect(after!.every((i) => i.status === 'paid'), 'all marked paid').toBe(true);
  });
});
