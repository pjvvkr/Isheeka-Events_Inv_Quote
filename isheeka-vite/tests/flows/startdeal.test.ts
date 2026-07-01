import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../../src/lib/supabase';
import { startDeal } from '../../src/lib/deal.js';

// ── Phase 2b: the canonical entry point ──────────────────────────────────────
// startDeal must produce the same spine as a normally-approved deal:
//   quick     → lead → client RFQ (converted, items seeded) → draft quote (price blank)
//   send      → lead → client RFQ (sent), no quote yet
// Requires E2E_EMAIL / E2E_PASSWORD against a LOCAL/throwaway Studio (creates data).

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const created: { table: string; col: string; id: any }[] = [];

describe('startDeal — canonical entry point', () => {
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
        await supabase.from('rfq_items').delete().eq('rfq_id', id);
        await supabase.from('rfq_activity').delete().eq('rfq_id', id);
      }
      for (const { table, col, id } of [...created].reverse()) await supabase.from(table).delete().eq(col, id);
    } catch { /* throwaway local DB — ignore */ }
    await supabase.auth.signOut();
  });

  it('quick — lead → converted RFQ (items seeded) → draft quote, price blank', async () => {
    const items = [
      { description: 'Stage decor', quantity: 1, sub_event_name: 'Reception', sub_items: [{ name: 'Backdrop', qty: 1 }] },
      { description: 'Chairs', quantity: 200, sub_event_name: 'Reception', sub_items: [] },
    ];
    const res: any = await startDeal({ mode: 'quick', prefill: { first_name: 'SD', last_name: 'Quick', phone: '9990001111', event_type: 'wedding' }, items });

    expect(res.lead_id, 'lead created').toBeTruthy();
    expect(res.rfq_id, 'rfq created').toBeTruthy();
    expect(res.quotation_id, 'draft quote created').toBeTruthy();
    created.push({ table: 'leads', col: 'lead_id', id: res.lead_id });
    created.push({ table: 'rfqs', col: 'rfq_id', id: res.rfq_id });
    created.push({ table: 'quotations', col: 'quotation_id', id: res.quotation_id });

    const { data: rfq } = await supabase.from('rfqs').select('status,quotation_id,client_id,lead_id').eq('rfq_id', res.rfq_id).single();
    expect(rfq!.status, 'RFQ converted').toBe('converted');
    expect(rfq!.quotation_id, 'RFQ linked to quote').toBe(res.quotation_id);
    expect(rfq!.lead_id, 'RFQ linked to lead').toBe(res.lead_id);
    if (rfq!.client_id) created.push({ table: 'clients', col: 'client_id', id: rfq!.client_id });

    const { data: ri } = await supabase.from('rfq_items').select('description').eq('rfq_id', res.rfq_id).eq('is_deleted', false);
    expect((ri || []).length, 'sourcing basis seeded').toBe(2);

    const { data: li } = await supabase.from('quotation_line_items').select('unit_price').eq('quotation_id', res.quotation_id).eq('is_deleted', false);
    expect((li || []).length, 'quote line items match').toBe(2);
    expect(li!.every((x) => Number(x.unit_price) === 0), 'price blank at approval').toBe(true);
  });

  it('send — lead + sent RFQ, no quote yet', async () => {
    const res: any = await startDeal({ mode: 'send', prefill: { first_name: 'SD', last_name: 'Send', phone: '9990002222', event_type: 'birthday' } });
    expect(res.lead_id).toBeTruthy();
    expect(res.rfq_id).toBeTruthy();
    expect(res.quotation_id, 'no quote in send mode').toBeNull();
    created.push({ table: 'leads', col: 'lead_id', id: res.lead_id });
    created.push({ table: 'rfqs', col: 'rfq_id', id: res.rfq_id });

    const { data: rfq } = await supabase.from('rfqs').select('status,lead_id').eq('rfq_id', res.rfq_id).single();
    expect(rfq!.status, 'RFQ awaiting client fill').toBe('sent');
    expect(rfq!.lead_id).toBe(res.lead_id);
  });
});
