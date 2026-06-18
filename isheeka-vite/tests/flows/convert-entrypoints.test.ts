import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { createEventFromQuote } from '../../src/lib/money.js';

// ── Convert entry points other than lead-origin ──────────────────────────────
// The lead-origin convert is covered in quote-to-event.test.ts. Here we cover the
// OTHER ways an event gets born from a quote with no lead attached (the RFQ/client
// path in QuotationDetail builds a synthetic "lead" with lead_id:null):
//   1. client-origin, existing client reused (forcedClientId)
//   2. client-origin, NO client yet → a brand-new client is created

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const created: { table: string; col: string; id: any }[] = [];
let seq = 0;
const uref = (p: string) => `${p}-${Date.now()}-${seq++}`;

async function makeQuoteNoLead(clientId: string | null) {
  let cid = clientId;
  if (cid) created.push({ table: 'clients', col: 'client_id', id: cid });
  const { data: quot } = await supabase.from('quotations').insert({
    ref_number: uref('Q-CE'), status: 'approved', client_id: cid, client_name: 'CE Client',
    event_name: 'CE Event', subtotal: 100000, discount_amount: 0, grand_total: 100000,
    payment_schedule: JSON.stringify([{ pct: 100, amount: 100000 }]),
  }).select().single();
  created.push({ table: 'quotations', col: 'quotation_id', id: quot!.quotation_id });
  await supabase.from('quotation_line_items').insert([{ quotation_id: quot!.quotation_id, description: 'Decor', quantity: 1, unit_price: 100000, amount: 100000, sort_order: 0 }]);
  return quot!;
}

describe('convert entry points (no lead)', () => {
  beforeAll(async () => {
    if (!EMAIL || !PASSWORD) throw new Error('Set E2E_EMAIL and E2E_PASSWORD to run flow tests.');
    const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error('Login failed (is this user in your LOCAL Studio?): ' + error.message);
  });

  afterAll(async () => {
    try {
      for (const id of created.filter((c) => c.table === 'events').map((c) => c.id)) {
        const { data: invs } = await supabase.from('invoices').select('invoice_id').eq('event_id', id);
        for (const iv of invs || []) {
          await supabase.from('invoice_installments').delete().eq('invoice_id', iv.invoice_id);
          await supabase.from('invoice_line_items').delete().eq('invoice_id', iv.invoice_id);
          await supabase.from('invoice_activity_log').delete().eq('invoice_id', iv.invoice_id);
        }
        await supabase.from('invoices').delete().eq('event_id', id);
        await supabase.from('sub_events').delete().eq('event_id', id);
      }
      for (const id of created.filter((c) => c.table === 'quotations').map((c) => c.id)) {
        await supabase.from('quotation_line_items').delete().eq('quotation_id', id);
      }
      for (const { table, col, id } of [...created].reverse()) await supabase.from(table).delete().eq(col, id);
    } catch { /* throwaway local DB — ignore */ }
    await supabase.auth.signOut();
  });

  it('client-origin — reuses the existing client, creates event + invoice, touches no lead', async () => {
    const { data: client } = await supabase.from('clients').insert({ first_name: 'CE', last_name: 'Reuse' }).select().single();
    const quot = await makeQuoteNoLead(client!.client_id);
    const synthLead = {
      lead_id: null, client_id: client!.client_id, first_name: 'CE', last_name: 'Reuse',
      phone: '9999999999', phone_2: '', email: '', source: 'referral', event_type: 'wedding',
      tentative_date: '2026-12-01', location: 'Hyderabad',
    };

    const res: any = await createEventFromQuote(synthLead, { quot, forcedClientId: client!.client_id });
    expect(res?.eventId, 'eventId returned').toBeTruthy();
    expect(res.clientOutcome, 'existing client reused').toBe('reused');
    created.push({ table: 'events', col: 'event_id', id: res.eventId });

    const { data: ev } = await supabase.from('events').select('client_id,lead_id').eq('event_id', res.eventId).single();
    expect(ev!.client_id, 'event uses the existing client').toBe(client!.client_id);
    expect(ev!.lead_id, 'no lead attached (client-origin)').toBeNull();

    const { data: q2 } = await supabase.from('quotations').select('status,event_id').eq('quotation_id', quot.quotation_id).single();
    expect(q2!.status, 'quote converted').toBe('converted');
    expect(q2!.event_id, 'quote linked to event').toBe(res.eventId);

    const { data: invs } = await supabase.from('invoices').select('grand_total').eq('event_id', res.eventId).eq('is_deleted', false);
    expect(invs?.length, 'invoice raised').toBe(1);
    expect(Number(invs![0].grand_total), 'invoice total').toBe(100000);
  });

  it('client-origin with no client — creates a brand-new client and links it', async () => {
    const quot = await makeQuoteNoLead(null);
    const lastName = 'New' + Date.now();
    const synthLead = {
      lead_id: null, client_id: null, first_name: 'Fresh', last_name: lastName,
      phone: '8888888888', phone_2: '', email: 'fresh@example.com', source: 'referral',
      event_type: 'birthday', tentative_date: null, location: null,
    };

    const res: any = await createEventFromQuote(synthLead, { quot }); // no forcedClientId/client_id → new client created
    expect(res?.eventId, 'eventId returned').toBeTruthy();
    expect(res.clientOutcome, 'a new client was created').toBe('created');
    created.push({ table: 'events', col: 'event_id', id: res.eventId });

    const { data: ev } = await supabase.from('events').select('client_id').eq('event_id', res.eventId).single();
    expect(ev!.client_id, 'event linked to the new client').toBeTruthy();
    created.push({ table: 'clients', col: 'client_id', id: ev!.client_id }); // track for cleanup

    const { data: newClient } = await supabase.from('clients').select('first_name,last_name').eq('client_id', ev!.client_id).single();
    expect(newClient!.last_name, 'new client carries the synth-lead name').toBe(lastName);

    const { data: invs } = await supabase.from('invoices').select('grand_total').eq('event_id', res.eventId).eq('is_deleted', false);
    expect(invs?.length, 'invoice raised').toBe(1);
  });
});
