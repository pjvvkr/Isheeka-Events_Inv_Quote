import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { createInvoiceFromQuote, reconcileInvoiceInstallments, recordClientRefund } from '../../src/lib/money.js';

// ── Logic flow: payment reconciliation + refund ──────────────────────────────
// Closes the money loop. Builds a ₹1,00,000 invoice (two ₹50,000 installments), then
// drives the REAL reconcileInvoiceInstallments() through a partial then full payment,
// and the REAL recordClientRefund() for a partial refund — asserting the installment
// ledger (amount_paid / balance / status) and the invoice header stay exactly in sync.

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const created: { table: string; col: string; id: any }[] = [];

async function installmentsOf(invoiceId: string) {
  const { data } = await supabase.from('invoice_installments').select('*').eq('invoice_id', invoiceId).order('installment_number');
  return data || [];
}

describe('flow: invoice payment reconciliation + refund', () => {
  beforeAll(async () => {
    if (!EMAIL || !PASSWORD) throw new Error('Set E2E_EMAIL and E2E_PASSWORD to run flow tests.');
    const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error('Login failed (is this user in your LOCAL Studio?): ' + error.message);
  });

  afterAll(async () => {
    try {
      for (const id of created.filter((c) => c.table === 'invoices').map((c) => c.id)) {
        await supabase.from('invoice_payments').delete().eq('invoice_id', id);
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

  it('allocates partial + full payments correctly, then re-opens an installment on refund', async () => {
    // setup: invoice with two ₹50,000 installments
    const { data: client } = await supabase.from('clients').insert({ first_name: 'Pay', last_name: 'Test' }).select().single();
    created.push({ table: 'clients', col: 'client_id', id: client!.client_id });
    const { data: event } = await supabase.from('events').insert({ name: 'Pay Test Event', client_id: client!.client_id, client_name: 'Pay Test', status: 'planning' }).select().single();
    created.push({ table: 'events', col: 'event_id', id: event!.event_id });
    const schedule = [
      { pct: 50, amount: 50000, label: 'Advance', when: 'On confirmation' },
      { pct: 50, amount: 50000, label: 'Balance', when: 'On event day' },
    ];
    const { data: quot } = await supabase.from('quotations').insert({
      ref_number: 'Q-PAY-' + Date.now(), status: 'approved', client_id: client!.client_id, client_name: 'Pay Test',
      event_id: event!.event_id, event_name: 'Pay Test Event', subtotal: 100000, discount_amount: 0, grand_total: 100000,
      payment_schedule: JSON.stringify(schedule),
    }).select().single();
    created.push({ table: 'quotations', col: 'quotation_id', id: quot!.quotation_id });
    await supabase.from('quotation_line_items').insert([{ quotation_id: quot!.quotation_id, description: 'Decor', quantity: 1, unit_price: 100000, amount: 100000, sort_order: 0 }]);
    const inv: any = await createInvoiceFromQuote(quot!.quotation_id, { eventId: event!.event_id });
    created.push({ table: 'invoices', col: 'invoice_id', id: inv.invoice_id });

    // ── partial payment: ₹50,000 ──
    await reconcileInvoiceInstallments(await installmentsOf(inv.invoice_id), 50000);
    let insts = await installmentsOf(inv.invoice_id);
    expect(Number(insts[0].amount_paid), 'advance paid in full').toBe(50000);
    expect(insts[0].status, 'advance status').toBe('paid');
    expect(Number(insts[1].amount_paid), 'balance untouched').toBe(0);
    expect(insts[1].status, 'balance status').toBe('pending');

    // ── full payment: ₹1,00,000 ──
    await reconcileInvoiceInstallments(await installmentsOf(inv.invoice_id), 100000);
    insts = await installmentsOf(inv.invoice_id);
    expect(insts.every((i) => i.status === 'paid'), 'both installments paid').toBe(true);
    expect(insts.reduce((s, i) => s + Number(i.balance), 0), 'no balance left').toBe(0);

    // put the header into a fully-paid state (what the app's payment handler does), then refund ₹50,000
    await supabase.from('invoices').update({ total_received: 100000, total_outstanding: 0, status: 'paid' }).eq('invoice_id', inv.invoice_id);
    const { data: paidInv } = await supabase.from('invoices').select('*').eq('invoice_id', inv.invoice_id).single();

    await recordClientRefund(paidInv, { amount: 50000, reason: 'Test refund', date: '2026-06-17' });

    // header re-opened to partially-paid
    const { data: afterInv } = await supabase.from('invoices').select('total_received,total_outstanding,status').eq('invoice_id', inv.invoice_id).single();
    expect(Number(afterInv!.total_received), 'received after refund').toBe(50000);
    expect(Number(afterInv!.total_outstanding), 'outstanding after refund').toBe(50000);
    expect(afterInv!.status, 'status after refund').toBe('partially_paid');

    // the LAST installment re-opened (refund reverses last → first)
    insts = await installmentsOf(inv.invoice_id);
    expect(insts[1].status, 'balance installment re-opened').toBe('pending');
    expect(Number(insts[1].balance), 'balance installment owes again').toBe(50000);
    expect(Number(insts[0].amount_paid), 'advance stays paid').toBe(50000);

    // a negative (refund) payment row was recorded
    const { data: pays } = await supabase.from('invoice_payments').select('amount,is_refund').eq('invoice_id', inv.invoice_id);
    const refundRow = (pays || []).find((p) => p.is_refund);
    expect(refundRow, 'a refund payment row exists').toBeTruthy();
    expect(Number(refundRow!.amount), 'refund recorded as negative').toBe(-50000);
  });
});
