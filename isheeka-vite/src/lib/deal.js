// Canonical deal starter (Phase 2b). Every deal begins Lead → client RFQ → draft Quote,
// composed from existing primitives so the fast paths share ONE spine:
//   - mode 'send'      : create lead + client RFQ, hand back the link. Client fills items,
//                        then the normal Approve flow prices it (unchanged behaviour).
//   - mode 'quick'     : walk-in — create lead + client RFQ, seed the given items as the
//                        sourcing basis, approve → draft quote; caller lands on it to price now.
//   - mode 'reference' : same as quick, with items cloned from a reference event.
// No manual (quote-less) events; no lead→quote shortcut. Gated by VITE_ENFORCE_CANONICAL_PATH.
import { supabase } from './supabase';
import { runDb } from './toast.jsx';
import { getNextLeadRef } from './refs.js';
import { createRfq, approveRfqToQuote } from './rfq.js';

// Ships DORMANT (default off) so 2b can land without disrupting live use. Set
// VITE_ENFORCE_CANONICAL_PATH=true (env / Netlify) to enforce the canonical Lead→RFQ→Quote path.
export const ENFORCE_CANONICAL_PATH =
  !!(import.meta.env && String(import.meta.env.VITE_ENFORCE_CANONICAL_PATH) === 'true');

const fullName = (c) => [c && c.first_name, c && c.last_name].filter(Boolean).join(' ').trim() || null;

// Create a lead row (shape extracted from LeadsModule.handleSaveNew).
export async function createLead(form = {}) {
  const ref_number = await getNextLeadRef();
  const now = new Date().toISOString();
  const payload = {
    ref_number,
    first_name: form.first_name || '',
    last_name: form.last_name || '',
    phone: form.phone || null,
    phone_2: form.phone_2 || null,
    email: form.email || null,
    source: form.source || null,
    event_type: form.event_type || null,
    tentative_date: form.tentative_date || null,
    location: form.location || null,
    budget: form.budget ? parseFloat(form.budget) : null,
    guest_count: form.guest_count ? parseInt(form.guest_count) : null,
    venue_preference: form.venue_preference || null,
    referred_by: form.referred_by || null,
    stage: form.stage || 'new',
    assigned_to: form.assigned_to || null,
    notes: form.notes || null,
    follow_up_date: form.follow_up_date || null,
    created_at: now, updated_at: now, is_deleted: false,
  };
  const { data, error } = await runDb(supabase.from('leads').insert(payload).select('lead_id,ref_number').single(), 'create lead');
  if (error || !data) throw error || new Error('lead create failed');
  return { lead_id: data.lead_id, ref_number: data.ref_number };
}

// Seed a client RFQ's items = the sourcing basis (shape mirrors RFQsModule staff-edit insert).
async function seedRfqItems(rfqId, items) {
  const rows = (items || [])
    .filter((it) => String(it && it.description || '').trim())
    .map((it, idx) => ({
      rfq_id: rfqId,
      sub_event_name: it.sub_event_name || null,
      description: it.description || '',
      quantity: parseFloat(it.quantity) || 1,
      sort_order: idx,
      source: it.source || 'custom',
      sub_items: (it.sub_items || []).filter((si) => si && String(si.name || '').trim()),
    }));
  if (rows.length) await runDb(supabase.from('rfq_items').insert(rows), 'seed deal RFQ items');
  return rows.length;
}

// The single canonical entry point. Returns { mode, lead_id, rfq_id, quotation_id, ... }.
export async function startDeal({ mode = 'send', client = {}, prefill = {}, items = [] } = {}) {
  const name = fullName(client);

  // 1) Lead — top of the canonical spine.
  const lead = await createLead({
    first_name: client.first_name || prefill.first_name,
    last_name: client.last_name || prefill.last_name,
    phone: client.phone || prefill.phone,
    email: client.email || prefill.email,
    event_type: prefill.event_type,
    tentative_date: prefill.event_date,
    guest_count: prefill.guest_count,
    location: prefill.city || prefill.location,
    source: prefill.source || null,
    notes: prefill.notes || null,
  });

  // 2) Client RFQ — the sourcing anchor.
  const rfq = await createRfq({
    lead_id: lead.lead_id,
    client_id: client.client_id || null,
    contact_first_name: client.first_name || prefill.first_name || null,
    contact_last_name: client.last_name || prefill.last_name || null,
    contact_name: name,
    contact_phone: client.phone || prefill.phone || null,
    contact_email: client.email || prefill.email || null,
    event_type: prefill.event_type || null,
    event_date: prefill.event_date || null,
    guest_count: prefill.guest_count || null,
    city: prefill.city || null,
    location: prefill.location || null,
  });

  // 3a) Send path: client fills the link; existing Approve flow prices it later. If items were
  // provided (e.g. a reference clone sent for confirmation), seed them onto the RFQ first.
  if (mode === 'send') {
    if (items && items.length) await seedRfqItems(rfq.rfq_id, items);
    return { mode, lead_id: lead.lead_id, rfq_id: rfq.rfq_id, ref_number: rfq.ref_number, token: rfq.token, pin: rfq.pin, quotation_id: null };
  }

  // 3b) Quick deal with no inline items yet: staff captures the requirements + approves on the
  // RFQ screen, so mark it 'submitted' (approvable) and hand back the RFQ to open.
  if (!(items && items.length)) {
    try { await supabase.from('rfqs').update({ status: 'submitted', updated_at: new Date().toISOString() }).eq('rfq_id', rfq.rfq_id); } catch (e) { /* non-fatal */ }
    return { mode, lead_id: lead.lead_id, rfq_id: rfq.rfq_id, ref_number: rfq.ref_number, quotation_id: null };
  }

  // 3c) Quick-with-items / reference: seed items → approve → draft quote (approveRfqToQuote also
  // marks the RFQ converted and links client + quotation).
  await seedRfqItems(rfq.rfq_id, items);
  const rForApprove = {
    rfq_id: rfq.rfq_id, lead_id: lead.lead_id,
    client_id: client.client_id || null,
    contact_first_name: client.first_name || prefill.first_name || null,
    contact_last_name: client.last_name || prefill.last_name || null,
    contact_name: name,
    contact_phone: client.phone || prefill.phone || null,
    contact_email: client.email || prefill.email || null,
    event_type: prefill.event_type || null,
    notes: prefill.notes || null,
    city: prefill.city || null,
  };
  const forced = client.client_id ? { client_id: client.client_id, client_name: name || '' } : undefined;
  const q = await approveRfqToQuote(rForApprove, items, forced);
  return { mode, lead_id: lead.lead_id, rfq_id: rfq.rfq_id, quotation_id: q.quotation_id, quote_ref: q.ref_number };
}
