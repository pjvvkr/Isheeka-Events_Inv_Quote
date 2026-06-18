import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { createEventFromQuote } from '../../src/lib/money.js';

// ── Logic flow: confirmed quote → event (the "Convert" step) ─────────────────
// Drives the REAL createEventFromQuote() and verifies the whole conversion fans out
// correctly: event created from the lead, the quote marked converted + linked, a
// draft invoice raised, sub-events built from the line items, and the source lead
// advanced to "event_triggered". Each assertion is labelled with the step it checks.

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

const created: { table: string; col: string; id: any }[] = [];

describe('flow: confirmed quote → event (convert)', () => {
  beforeAll(async () => {
    if (!EMAIL || !PASSWORD) throw new Error('Set E2E_EMAIL and E2E_PASSWORD to run flow tests.');
    const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error('Login failed (is this user in your LOCAL Studio?): ' + error.message);
  });

  afterAll(async () => {
    try {
      const eventIds = created.filter((c) => c.table === 'events').map((c) => c.id);
      for (const eid of eventIds) {
        const { data: invs } = await supabase.from('invoices').select('invoice_id').eq('event_id', eid);
        for (const iv of invs || []) {
          await supabase.from('invoice_installments').delete().eq('invoice_id', iv.invoice_id);
          await supabase.from('invoice_line_items').delete().eq('invoice_id', iv.invoice_id);
          await supabase.from('invoice_activity_log').delete().eq('invoice_id', iv.invoice_id);
        }
        await supabase.from('invoices').delete().eq('event_id', eid);
        await supabase.from('sub_events').delete().eq('event_id', eid);
      }
      for (const id of created.filter((c) => c.table === 'quotations').map((c) => c.id)) {
        await supabase.from('quotation_line_items').delete().eq('quotation_id', id);
      }
      for (const { table, col, id } of [...created].reverse()) await supabase.from(table).delete().eq(col, id);
    } catch { /* throwaway local DB — ignore */ }
    await supabase.auth.signOut();
  });

  it('creates the event, converts + links the quote, raises a draft invoice, and advances the lead', async () => {
    // client + lead
    const { data: client } = await supabase.from('clients').insert({ first_name: 'Conv', last_name: 'Test' }).select().single();
    created.push({ table: 'clients', col: 'client_id', id: client!.client_id });

    const { data: lead, error: le } = await supabase.from('leads').insert({
      first_name: 'Conv', last_name: 'Test', event_type: 'wedding',
      tentative_date: '2026-12-01', location: 'Hyderabad', stage: 'quote_confirmed',
      client_id: client!.client_id,
    }).select().single();
    expect(le, 'insert lead').toBeNull();
    created.push({ table: 'leads', col: 'lead_id', id: lead!.lead_id });

    // approved quote (not yet linked to an event) + line items (one in a sub-event)
    const schedule = [
      { pct: 50, amount: 50000, label: 'Advance', when: 'On confirmation' },
      { pct: 50, amount: 50000, label: 'Balance', when: 'On event day' },
    ];
    const { data: quot } = await supabase.from('quotations').insert({
      ref_number: 'Q-CONV-' + Date.now(), status: 'approved',
      client_id: client!.client_id, client_name: 'Conv Test', lead_id: lead!.lead_id,
      event_name: 'Conv Wedding', subtotal: 100000, discount_amount: 0, grand_total: 100000,
      payment_schedule: JSON.stringify(schedule),
    }).select().single();
    created.push({ table: 'quotations', col: 'quotation_id', id: quot!.quotation_id });

    await supabase.from('quotation_line_items').insert([
      { quotation_id: quot!.quotation_id, sub_event_name: 'Mehendi', description: 'Mehendi decor', quantity: 1, unit_price: 60000, amount: 60000, sort_order: 0 },
      { quotation_id: quot!.quotation_id, sub_event_name: null, description: 'Photography', quantity: 1, unit_price: 40000, amount: 40000, sort_order: 1 },
    ]);

    // ── function under test ── (reuse the existing client, so outcome = 'reused')
    const res: any = await createEventFromQuote(lead, { quot, forcedClientId: client!.client_id });
    expect(res?.eventId, 'conversion returned an eventId').toBeTruthy();
    expect(res.clientOutcome, 'existing client reused (not re-created)').toBe('reused');
    created.push({ table: 'events', col: 'event_id', id: res.eventId });

    // event created from the lead
    const { data: ev } = await supabase.from('events').select('*').eq('event_id', res.eventId).single();
    expect(ev?.lead_id, 'event linked to source lead').toBe(lead!.lead_id);
    expect(ev?.client_id, 'event linked to client').toBe(client!.client_id);
    expect(ev?.name, 'event name from quote').toBe('Conv Wedding');

    // quote marked converted + linked to the event
    const { data: q2 } = await supabase.from('quotations').select('status,event_id').eq('quotation_id', quot!.quotation_id).single();
    expect(q2?.status, 'quote status after convert').toBe('converted');
    expect(q2?.event_id, 'quote now points at the new event').toBe(res.eventId);

    // a draft invoice was raised for the event, matching the quote total
    const { data: invs } = await supabase.from('invoices').select('*').eq('event_id', res.eventId).eq('is_deleted', false);
    expect(invs?.length, 'one invoice raised on convert').toBe(1);
    expect(invs![0].status, 'invoice status').toBe('draft');
    expect(Number(invs![0].grand_total), 'invoice total matches quote').toBe(100000);

    // sub-events built from the line items (the named one; the null/general one makes none)
    const { data: subs } = await supabase.from('sub_events').select('name').eq('event_id', res.eventId).eq('is_deleted', false);
    expect(subs?.map((s) => s.name), 'sub-events created from line items').toContain('Mehendi');

    // source lead advanced
    const { data: l2 } = await supabase.from('leads').select('stage,event_id,converted_at').eq('lead_id', lead!.lead_id).single();
    expect(l2?.stage, 'lead stage after convert').toBe('event_triggered');
    expect(l2?.event_id, 'lead linked to the new event').toBe(res.eventId);
    expect(l2?.converted_at, 'lead converted_at stamped').toBeTruthy();
  });
});
