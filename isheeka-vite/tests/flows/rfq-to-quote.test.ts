import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { approveRfqToQuote } from '../../src/lib/rfq.js';

// ── Entry point: RFQ → draft quote ───────────────────────────────────────────
// Drives the REAL approveRfqToQuote(): turns a submitted RFQ + its items into a draft
// quotation (prices blank), copies the items item-for-item, and flips the RFQ to
// "converted" linked to the new quote. Client is pre-set so we test the approve path,
// not the dedupe branch.

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const created: { table: string; col: string; id: any }[] = [];
const uref = (p: string) => `${p}-${Date.now()}`;

describe('entry point: RFQ → draft quote', () => {
  beforeAll(async () => {
    if (!EMAIL || !PASSWORD) throw new Error('Set E2E_EMAIL and E2E_PASSWORD to run flow tests.');
    const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error('Login failed (is this user in your LOCAL Studio?): ' + error.message);
  });

  afterAll(async () => {
    try {
      for (const id of created.filter((c) => c.table === 'quotations').map((c) => c.id)) {
        await supabase.from('quotation_line_items').delete().eq('quotation_id', id);
      }
      for (const id of created.filter((c) => c.table === 'rfqs').map((c) => c.id)) {
        await supabase.from('rfq_activity').delete().eq('rfq_id', id);
      }
      for (const { table, col, id } of [...created].reverse()) await supabase.from(table).delete().eq(col, id);
    } catch { /* throwaway local DB — ignore */ }
    await supabase.auth.signOut();
  });

  it('approves an RFQ into a draft quote, copies items, and converts the RFQ', async () => {
    const { data: client } = await supabase.from('clients').insert({ first_name: 'RFQ', last_name: 'Client' }).select().single();
    created.push({ table: 'clients', col: 'client_id', id: client!.client_id });

    const { data: rfq } = await supabase.from('rfqs').insert({
      ref_number: uref('RFQ'), token_hash: 'test-token-hash', status: 'submitted',
      client_id: client!.client_id, contact_name: 'RFQ Client', event_type: 'wedding',
    }).select().single();
    created.push({ table: 'rfqs', col: 'rfq_id', id: rfq!.rfq_id });

    const items = [
      { description: 'Stage', quantity: 1, sub_event_name: 'Reception' },
      { description: 'Catering', quantity: 100, sub_event_name: null },
    ];

    const q: any = await approveRfqToQuote(rfq, items, null);
    expect(q?.quotation_id, 'a quote was created').toBeTruthy();
    created.push({ table: 'quotations', col: 'quotation_id', id: q.quotation_id });

    // the quote is a blank-priced DRAFT linked to the client
    const { data: quote } = await supabase.from('quotations').select('*').eq('quotation_id', q.quotation_id).single();
    expect(quote!.status, 'quote is a draft').toBe('draft');
    expect(quote!.client_id, 'quote linked to the RFQ client').toBe(client!.client_id);
    expect(Number(quote!.grand_total), 'prices are blank (₹0) until staff fills them').toBe(0);
    expect(String(quote!.event_name || ''), 'event name derived from event type').toContain('Event');

    // items copied item-for-item, price blank
    const { data: li } = await supabase.from('quotation_line_items').select('description,quantity,unit_price').eq('quotation_id', q.quotation_id).order('sort_order');
    expect(li?.length, 'both items copied').toBe(2);
    expect(li!.map((x) => x.description), 'descriptions copied').toEqual(['Stage', 'Catering']);
    expect(Number(li![0].unit_price), 'price blank on copy').toBe(0);

    // RFQ flipped to converted + linked to the quote
    const { data: r2 } = await supabase.from('rfqs').select('status,quotation_id,client_id').eq('rfq_id', rfq!.rfq_id).single();
    expect(r2!.status, 'RFQ converted').toBe('converted');
    expect(r2!.quotation_id, 'RFQ linked to the new quote').toBe(q.quotation_id);
    expect(r2!.client_id, 'RFQ linked to client').toBe(client!.client_id);
  });
});
