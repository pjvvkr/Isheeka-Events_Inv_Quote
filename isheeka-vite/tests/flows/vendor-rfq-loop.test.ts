import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { approveRfqToQuote } from '../../src/lib/rfq.js';
import { createVendorRfqs, loadVendorRfqs, loadVendorRfqItems, bumpReminder } from '../../src/lib/vendorRfq.js';
import { loadCostingData, generateQuoteFromCosting, saveCostingSummary, costKey } from '../../src/lib/costing.js';

// ── Milestone S end-to-end (logic): client RFQ → vendor RFQ → bid → costing → quote ──
// Drives the REAL app-side functions against the local Supabase. The vendor's portal
// submission is simulated by writing the cost fields directly to the vendor RFQ's items
// (exactly what the rfq-gateway vendor branch does), since the gateway is an HTTP edge
// function that needs SESSION_SECRET — out of scope for a logic test.

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const created: { table: string; col: string; id: any }[] = [];
const uref = (p: string) => `${p}-${Date.now()}`;

describe('Milestone S: vendor RFQ → costing → priced quote', () => {
  beforeAll(async () => {
    if (!EMAIL || !PASSWORD) throw new Error('Set E2E_EMAIL and E2E_PASSWORD to run flow tests.');
    const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error('Login failed (is this user in your LOCAL Studio?): ' + error.message);
  });

  afterAll(async () => {
    try {
      for (const id of created.filter((c) => c.table === 'quotations').map((c) => c.id)) await supabase.from('quotation_line_items').delete().eq('quotation_id', id);
      for (const id of created.filter((c) => c.table === 'rfqs').map((c) => c.id)) await supabase.from('costing_summaries').delete().eq('client_rfq_id', id);
      for (const { table, col, id } of [...created].reverse()) await supabase.from(table).delete().eq(col, id); // cascades vendor rfq_items + activity
    } catch { /* throwaway local DB — ignore */ }
    await supabase.auth.signOut();
  });

  it('sends a vendor RFQ, prices the bid through costing, and fills the draft quote', async () => {
    // ── setup: a client + an approved client RFQ with two items + its draft quote ──
    const { data: client } = await supabase.from('clients').insert({ first_name: 'Vendor', last_name: 'Loop' }).select().single();
    created.push({ table: 'clients', col: 'client_id', id: client!.client_id });

    const { data: rfq } = await supabase.from('rfqs').insert({
      ref_number: uref('R'), token_hash: 'test-token-hash', status: 'submitted', party_type: 'client',
      client_id: client!.client_id, contact_name: 'Vendor Loop', event_type: 'wedding', city: 'Hyderabad',
    }).select().single();
    created.push({ table: 'rfqs', col: 'rfq_id', id: rfq!.rfq_id });

    const items = [
      { description: 'Stage', quantity: 1, sub_event_name: 'Reception' },
      { description: 'Lighting', quantity: 2, sub_event_name: 'Reception' },
    ];
    await supabase.from('rfq_items').insert(items.map((it, i) => ({ rfq_id: rfq!.rfq_id, description: it.description, quantity: it.quantity, sub_event_name: it.sub_event_name, sort_order: i })));

    const q: any = await approveRfqToQuote(rfq, items, null);
    created.push({ table: 'quotations', col: 'quotation_id', id: q.quotation_id });
    const parentRfq = { ...rfq, quotation_id: q.quotation_id };

    // ── a vendor + send them a vendor RFQ ──
    const { data: vendor } = await supabase.from('vendors').insert({ name: uref('TESTVendor'), phone_1: '+91 90000 00000', status: 'active' }).select().single();
    created.push({ table: 'vendors', col: 'vendor_id', id: vendor!.vendor_id });

    const sent = await createVendorRfqs(parentRfq, [vendor]);
    expect(sent.length, 'one vendor RFQ created').toBe(1);
    const vr = sent[0];
    created.push({ table: 'rfqs', col: 'rfq_id', id: vr.rfq_id });

    const { data: vrfqRow } = await supabase.from('rfqs').select('party_type,parent_rfq_id,vendor_id').eq('rfq_id', vr.rfq_id).single();
    expect(vrfqRow!.party_type, 'is a vendor RFQ').toBe('vendor');
    expect(vrfqRow!.parent_rfq_id, 'linked to the client RFQ').toBe(rfq!.rfq_id);
    expect(vrfqRow!.vendor_id, 'linked to the vendor').toBe(vendor!.vendor_id);

    const vItems = await loadVendorRfqItems(vr.rfq_id);
    expect(vItems.length, 'frozen item list copied to the vendor RFQ').toBe(2);

    // ── simulate the vendor submitting a bid (= the gateway vendor branch) ──
    for (const it of vItems) {
      if (it.description === 'Stage') await supabase.from('rfq_items').update({ unit_cost: 1000, can_supply: true, item_note: 'incl setup' }).eq('rfq_item_id', it.rfq_item_id);
      else await supabase.from('rfq_items').update({ can_supply: false }).eq('rfq_item_id', it.rfq_item_id); // Lighting: can't supply
    }
    await supabase.from('rfqs').update({ status: 'submitted' }).eq('rfq_id', vr.rfq_id);

    // ── reminder tracking ──
    const n = await bumpReminder(vr.rfq_id);
    expect(n, 'reminder counter increments').toBe(1);

    // ── costing: the bid shows up; build priced rows (cheapest vendor, else in-house) ──
    const d: any = await loadCostingData(rfq!.rfq_id);
    expect(d.columns.map((c: any) => c.vendor_id), 'submitted vendor is a column').toContain(vendor!.vendor_id);
    expect(d.draftQuoteId, 'costing knows the draft quote').toBe(q.quotation_id);
    expect(Number(d.defaultMarkup), 'default markup loaded').toBe(30);

    const rows = d.clientItems.map((it: any) => {
      const bids = d.bidsByKey[costKey(it)] || [];
      const supplying = bids.filter((b: any) => b.can_supply !== false && b.unit_cost != null).map((b: any) => Number(b.unit_cost));
      const cost = supplying.length ? Math.min(...supplying) : (it.description === 'Lighting' ? 500 : null); // in-house fallback for can't-supply
      const clientUnitPrice = cost == null ? null : Math.round(cost * (1 + d.defaultMarkup / 100));
      return { sub_event_name: it.sub_event_name, description: it.description, quantity: Number(it.quantity) || 1, cost, clientUnitPrice };
    });
    expect(rows.every((r: any) => r.clientUnitPrice != null), 'every item resolves to a price').toBe(true);
    const stage = rows.find((r: any) => r.description === 'Stage');
    const lighting = rows.find((r: any) => r.description === 'Lighting');
    expect(stage.clientUnitPrice, 'Stage: 1000 cost +30% = 1300').toBe(1300);
    expect(lighting.clientUnitPrice, 'Lighting: in-house 500 +30% = 650').toBe(650);

    // ── generate quote: prices land on the draft quote, totals recomputed ──
    await generateQuoteFromCosting(d.draftQuoteId, rows.map((r: any) => ({ sub_event_name: r.sub_event_name, description: r.description, quantity: r.quantity, clientUnitPrice: r.clientUnitPrice })));
    const { data: li } = await supabase.from('quotation_line_items').select('description,unit_price,amount').eq('quotation_id', q.quotation_id).eq('is_deleted', false).order('sort_order');
    expect(li!.length, 'two priced line items').toBe(2);
    const liStage = li!.find((x: any) => x.description === 'Stage');
    expect(Number(liStage!.unit_price), 'Stage priced at 1300').toBe(1300);
    const { data: quote } = await supabase.from('quotations').select('subtotal,grand_total').eq('quotation_id', q.quotation_id).single();
    expect(Number(quote!.grand_total), 'grand total = 1300*1 + 650*2 = 2600').toBe(2600);

    // ── costing summary saved (audit) ──
    const totalCost = 1000 * 1 + 500 * 2;            // 2000
    const totalClient = 1300 * 1 + 650 * 2;          // 2600
    await saveCostingSummary({ client_rfq_id: rfq!.rfq_id, quotation_id: q.quotation_id, default_markup_pct: d.defaultMarkup, total_cost: totalCost, total_client: totalClient, total_margin: totalClient - totalCost, internal_notes: 'test run', lines: rows });
    const { data: cs } = await supabase.from('costing_summaries').select('total_cost,total_client,total_margin,internal_notes').eq('client_rfq_id', rfq!.rfq_id).order('generated_at', { ascending: false }).limit(1).maybeSingle();
    expect(cs, 'a costing summary was saved').toBeTruthy();
    expect(Number(cs!.total_client), 'summary client total').toBe(2600);
    expect(Number(cs!.total_margin), 'summary margin = 600').toBe(600);
  });
});
