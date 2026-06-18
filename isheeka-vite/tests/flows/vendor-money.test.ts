import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { addEventVendor, recordVendorPayment, recordVendorRefund } from '../../src/lib/money.js';

// ── Vendor money flow ────────────────────────────────────────────────────────
// Whole untested area. Drives the REAL addEventVendor → recordVendorPayment (partial
// then full) → recordVendorRefund, asserting the engagement (event_vendors) AND its
// installment ledger stay exactly in sync at every step.

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const created: { table: string; col: string; id: any }[] = [];

async function refetchEV(id: string) {
  const { data } = await supabase.from('event_vendors').select('*').eq('event_vendor_id', id).single();
  return data!;
}
async function instOf(evId: string) {
  const { data } = await supabase.from('vendor_installments').select('*').eq('event_vendor_id', evId).order('installment_number');
  return (data || [])[0];
}

describe('vendor money: add → pay (partial, full) → refund', () => {
  beforeAll(async () => {
    if (!EMAIL || !PASSWORD) throw new Error('Set E2E_EMAIL and E2E_PASSWORD to run flow tests.');
    const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error('Login failed (is this user in your LOCAL Studio?): ' + error.message);
  });

  afterAll(async () => {
    try {
      for (const id of created.filter((c) => c.table === 'event_vendors').map((c) => c.id)) {
        await supabase.from('vendor_payments').delete().eq('event_vendor_id', id);
        await supabase.from('vendor_installments').delete().eq('event_vendor_id', id);
      }
      for (const { table, col, id } of [...created].reverse()) await supabase.from(table).delete().eq(col, id);
    } catch { /* throwaway local DB — ignore */ }
    await supabase.auth.signOut();
  });

  it('keeps the engagement + installment ledger in sync through pay and refund', async () => {
    const { data: event } = await supabase.from('events').insert({ name: 'Vendor Event', status: 'planning' }).select().single();
    created.push({ table: 'events', col: 'event_id', id: event!.event_id });

    // add a NEW vendor engaged for ₹50,000
    let ev: any = await addEventVendor({ eventId: event!.event_id, vendorName: 'Decor Co ' + Date.now(), category: 'decorator', service: 'Mandap', agreed: 50000 });
    created.push({ table: 'event_vendors', col: 'event_vendor_id', id: ev.event_vendor_id });
    if (ev.vendor_id) created.push({ table: 'vendors', col: 'vendor_id', id: ev.vendor_id });
    expect(Number(ev.agreed_amount), 'agreed').toBe(50000);
    expect(Number(ev.outstanding), 'starts fully outstanding').toBe(50000);
    expect(ev.status, 'starts pending').toBe('pending');
    let inst = await instOf(ev.event_vendor_id);
    expect(Number(inst.amount_due), 'one installment for the full agreed amount').toBe(50000);

    // ── partial payment ₹20,000 ──
    await recordVendorPayment(ev, { amount: 20000, date: '2026-06-17', mode: 'upi' });
    ev = await refetchEV(ev.event_vendor_id);
    expect(Number(ev.total_paid), 'paid after partial').toBe(20000);
    expect(Number(ev.outstanding), 'outstanding after partial').toBe(30000);
    expect(ev.status, 'status after partial').toBe('partially_paid');
    inst = await instOf(ev.event_vendor_id);
    expect(Number(inst.amount_paid), 'installment paid after partial').toBe(20000);
    expect(Number(inst.balance), 'installment balance after partial').toBe(30000);

    // ── settle the rest ₹30,000 ──
    await recordVendorPayment(ev, { amount: 30000, date: '2026-06-18', mode: 'neft' });
    ev = await refetchEV(ev.event_vendor_id);
    expect(Number(ev.total_paid), 'fully paid').toBe(50000);
    expect(Number(ev.outstanding), 'nothing outstanding').toBe(0);
    expect(ev.status, 'status fully paid').toBe('paid');
    inst = await instOf(ev.event_vendor_id);
    expect(inst.status, 'installment paid').toBe('paid');
    expect(Number(inst.balance), 'installment zero balance').toBe(0);

    // ── vendor refunds ₹10,000 ──
    await recordVendorRefund(ev, { amount: 10000, reason: 'Returned excess', date: '2026-06-19' });
    ev = await refetchEV(ev.event_vendor_id);
    expect(Number(ev.total_paid), 'paid rolled back by refund').toBe(40000);
    expect(Number(ev.outstanding), 'outstanding re-opened by refund').toBe(10000);
    expect(ev.status, 'status back to partially_paid').toBe('partially_paid');
    inst = await instOf(ev.event_vendor_id);
    expect(Number(inst.amount_paid), 'installment paid rolled back').toBe(40000);
    expect(Number(inst.balance), 'installment balance re-opened').toBe(10000);

    // a negative refund row exists
    const { data: pays } = await supabase.from('vendor_payments').select('amount,is_refund').eq('event_vendor_id', ev.event_vendor_id);
    const refundRow = (pays || []).find((p) => p.is_refund);
    expect(refundRow, 'a vendor refund row exists').toBeTruthy();
    expect(Number(refundRow!.amount), 'refund recorded negative').toBe(-10000);
  });
});
