import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { createInvoiceFromQuote } from '../../src/lib/money.js';

// ── Money-math variations of quote → invoice ─────────────────────────────────
// Exercises the branches of createInvoiceFromQuote that the happy-path test doesn't:
// discount, manual-total (negative) adjustment, percentage-only installment rounding,
// draft-invoice REFRESH-in-place on a revision, and GST recalculation on refresh.

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const created: { table: string; col: string; id: any }[] = [];

let seq = 0;
const uref = (p: string) => `${p}-${Date.now()}-${seq++}`;

async function makeQuote(opts: { subtotal: number; discount: number; schedule: any[]; items: any[] }) {
  const { data: client } = await supabase.from('clients').insert({ first_name: 'Var', last_name: 'Test' }).select().single();
  created.push({ table: 'clients', col: 'client_id', id: client!.client_id });
  const { data: event } = await supabase.from('events').insert({ name: 'Var Event', client_id: client!.client_id, client_name: 'Var Test', status: 'planning' }).select().single();
  created.push({ table: 'events', col: 'event_id', id: event!.event_id });
  const { data: quot } = await supabase.from('quotations').insert({
    ref_number: uref('Q-VAR'), status: 'approved', client_id: client!.client_id, client_name: 'Var Test',
    event_id: event!.event_id, event_name: 'Var Event',
    subtotal: opts.subtotal, discount_amount: opts.discount, grand_total: opts.subtotal - opts.discount,
    payment_schedule: JSON.stringify(opts.schedule),
  }).select().single();
  created.push({ table: 'quotations', col: 'quotation_id', id: quot!.quotation_id });
  await supabase.from('quotation_line_items').insert(opts.items.map((it: any, i: number) => ({ quotation_id: quot!.quotation_id, sort_order: i, ...it })));
  return { client: client!, event: event!, quot: quot! };
}

async function instsOf(invoiceId: string) {
  const { data } = await supabase.from('invoice_installments').select('*').eq('invoice_id', invoiceId).order('installment_number');
  return data || [];
}

describe('quote → invoice: money-math variations', () => {
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
      // events may carry an auto-created invoice that we didn't explicitly track
      for (const id of created.filter((c) => c.table === 'events').map((c) => c.id)) {
        const { data: invs } = await supabase.from('invoices').select('invoice_id').eq('event_id', id);
        for (const iv of invs || []) {
          await supabase.from('invoice_installments').delete().eq('invoice_id', iv.invoice_id);
          await supabase.from('invoice_line_items').delete().eq('invoice_id', iv.invoice_id);
          await supabase.from('invoice_activity_log').delete().eq('invoice_id', iv.invoice_id);
          await supabase.from('invoices').delete().eq('invoice_id', iv.invoice_id);
        }
      }
      for (const id of created.filter((c) => c.table === 'quotations').map((c) => c.id)) {
        await supabase.from('quotation_line_items').delete().eq('quotation_id', id);
      }
      for (const { table, col, id } of [...created].reverse()) await supabase.from(table).delete().eq(col, id);
    } catch { /* throwaway local DB — ignore */ }
    await supabase.auth.signOut();
  });

  it('C — fixed discount reduces the grand total', async () => {
    const { event, quot } = await makeQuote({
      subtotal: 100000, discount: 20000,
      schedule: [{ pct: 50, amount: 40000 }, { pct: 50, amount: 40000 }],
      items: [{ description: 'Decor', quantity: 1, unit_price: 80000, amount: 80000 }],
    });
    const inv: any = await createInvoiceFromQuote(quot.quotation_id, { eventId: event.event_id });
    expect(Number(inv.grand_total), 'grand = subtotal − discount').toBe(80000);
    expect(Number(inv.total_outstanding), 'outstanding = grand').toBe(80000);
    const insts = await instsOf(inv.invoice_id);
    expect(insts.reduce((s, i) => s + Number(i.amount_due), 0), 'installments sum to discounted grand').toBe(80000);
  });

  it('D — manual-total override (negative adjustment) raises the grand total', async () => {
    // override-above-subtotal is stored as a NEGATIVE discount_amount
    const { event, quot } = await makeQuote({
      subtotal: 100000, discount: -5000,
      schedule: [{ pct: 50, amount: 52500 }, { pct: 50, amount: 52500 }],
      items: [{ description: 'Decor', quantity: 1, unit_price: 100000, amount: 100000 }],
    });
    const inv: any = await createInvoiceFromQuote(quot.quotation_id, { eventId: event.event_id });
    expect(Number(inv.grand_total), 'grand = subtotal − (−5000)').toBe(105000);
    const insts = await instsOf(inv.invoice_id);
    expect(insts.reduce((s, i) => s + Number(i.amount_due), 0), 'installments sum to adjusted grand').toBe(105000);
  });

  it('E — percentage-only schedule rounds each installment from the grand', async () => {
    const { event, quot } = await makeQuote({
      subtotal: 100000, discount: 0,
      schedule: [{ pct: 33, amount: 0 }, { pct: 33, amount: 0 }, { pct: 34, amount: 0 }],
      items: [{ description: 'Decor', quantity: 1, unit_price: 100000, amount: 100000 }],
    });
    const inv: any = await createInvoiceFromQuote(quot.quotation_id, { eventId: event.event_id });
    const insts = await instsOf(inv.invoice_id);
    expect(insts.map((i) => Number(i.amount_due)), 'pct → round(grand×pct/100)').toEqual([33000, 33000, 34000]);
    expect(insts.reduce((s, i) => s + Number(i.amount_due), 0), 'pct installments still total the grand').toBe(100000);
  });

  it('F — revising a confirmed quote REFRESHES the same draft invoice in place', async () => {
    const { event, quot } = await makeQuote({
      subtotal: 100000, discount: 0,
      schedule: [{ pct: 100, amount: 100000 }],
      items: [{ description: 'Decor', quantity: 1, unit_price: 100000, amount: 100000 }],
    });
    const inv1: any = await createInvoiceFromQuote(quot.quotation_id, { eventId: event.event_id });
    expect(Number(inv1.grand_total)).toBe(100000);

    // a revision: new quote on the SAME event, higher total
    const { data: quot2 } = await supabase.from('quotations').insert({
      ref_number: uref('Q-VAR'), status: 'approved', client_id: quot.client_id, client_name: 'Var Test',
      event_id: event.event_id, event_name: 'Var Event', subtotal: 120000, discount_amount: 0, grand_total: 120000,
      payment_schedule: JSON.stringify([{ pct: 100, amount: 120000 }]),
    }).select().single();
    created.push({ table: 'quotations', col: 'quotation_id', id: quot2!.quotation_id });
    await supabase.from('quotation_line_items').insert([{ quotation_id: quot2!.quotation_id, description: 'Decor+', quantity: 1, unit_price: 120000, amount: 120000, sort_order: 0 }]);

    const inv2: any = await createInvoiceFromQuote(quot2!.quotation_id, { eventId: event.event_id });
    expect(inv2.invoice_id, 'same invoice refreshed (not a 2nd invoice)').toBe(inv1.invoice_id);

    const { data: fresh } = await supabase.from('invoices').select('grand_total,quotation_id').eq('invoice_id', inv1.invoice_id).single();
    expect(Number(fresh!.grand_total), 'invoice refreshed to revised total').toBe(120000);
    expect(fresh!.quotation_id, 'invoice repointed at the revised quote').toBe(quot2!.quotation_id);

    const { data: allInvs } = await supabase.from('invoices').select('invoice_id').eq('event_id', event.event_id).eq('is_deleted', false);
    expect(allInvs?.length, 'still exactly one invoice on the event').toBe(1);
  });

  it('G — GST toggled on a draft invoice is recalculated on the next refresh', async () => {
    const { event, quot } = await makeQuote({
      subtotal: 100000, discount: 0,
      schedule: [{ pct: 100, amount: 100000 }],
      items: [{ description: 'Decor', quantity: 1, unit_price: 100000, amount: 100000 }],
    });
    const inv: any = await createInvoiceFromQuote(quot.quotation_id, { eventId: event.event_id });
    // user toggles GST on the invoice
    await supabase.from('invoices').update({ gst_applicable: true, gst_pct: 18 }).eq('invoice_id', inv.invoice_id);
    // a refresh (e.g. confirming a revision) recomputes tax
    await createInvoiceFromQuote(quot.quotation_id, { eventId: event.event_id });
    const { data: fresh } = await supabase.from('invoices').select('subtotal,tax_amount,grand_total').eq('invoice_id', inv.invoice_id).single();
    expect(Number(fresh!.tax_amount), '18% GST on ₹1,00,000').toBe(18000);
    expect(Number(fresh!.grand_total), 'grand = taxable + tax').toBe(118000);
  });
});
