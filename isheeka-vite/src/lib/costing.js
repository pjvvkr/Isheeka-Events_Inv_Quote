// Milestone S · S3 — costing & markup logic.
// Joins the client RFQ items (rows) with each submitted vendor bid (columns), and turns
// the chosen cost + markup into a priced draft quote, plus a saved costing summary (audit).
// See docs/milestone-s-vendor-rfq-spec.md §4.3, §5.
import { supabase } from './supabase';
import { runDb } from './toast.jsx';
import { _currentUid } from './session.js';
import { loadVendorRfqs } from './vendorRfq.js';

export const costKey = (it) => (it.sub_event_name || '') + '||' + (it.description || '');

// Everything the costing screen needs.
export async function loadCostingData(clientRfqId) {
  const { data: rfq } = await supabase.from('rfqs').select('*').eq('rfq_id', clientRfqId).single();
  const { data: clientItems } = await supabase.from('rfq_items').select('*').eq('rfq_id', clientRfqId).eq('is_deleted', false).order('sort_order');
  const vrfqs = await loadVendorRfqs(clientRfqId);
  const vIds = vrfqs.map((v) => v.rfq_id);
  let vendorItems = [];
  if (vIds.length) {
    const { data } = await supabase.from('rfq_items').select('rfq_id,rfq_item_id,source_item_id,sub_event_name,description,quantity,unit_cost,can_supply,item_note').in('rfq_id', vIds).eq('is_deleted', false);
    vendorItems = data || [];
  }
  const { data: vendors } = await supabase.from('vendors').select('vendor_id,name').eq('is_deleted', false);
  const vendorMap = {}; (vendors || []).forEach((v) => { vendorMap[v.vendor_id] = v; });
  const { data: settings } = await supabase.from('settings').select('default_markup_pct').limit(1).maybeSingle();

  // Only vendors who actually submitted become comparison columns.
  const submitted = vrfqs.filter((v) => v.status === 'submitted');
  const submittedIds = submitted.map((v) => v.vendor_id);
  const rfqVendorOf = {}; vrfqs.forEach((v) => { rfqVendorOf[v.rfq_id] = v.vendor_id; });
  const bidsByKey = {};
  // vendorItemBySource[vendor_rfq_id][source_item_id] → vendor rfq_item record.
  // Used by the costing screen to distinguish "Not requested" / "Awaiting" / "Bid" states.
  const vendorItemBySource = {};
  vendorItems.forEach((vi) => {
    const vendorId = rfqVendorOf[vi.rfq_id];
    // Build source-item lookup for ALL vendors (not only submitted) so the UI can
    // show "Awaiting" for pending vendors that were sent the item.
    if (vi.source_item_id) {
      if (!vendorItemBySource[vi.rfq_id]) vendorItemBySource[vi.rfq_id] = {};
      vendorItemBySource[vi.rfq_id][vi.source_item_id] = vi;
    }
    if (!submittedIds.includes(vendorId)) return;
    (bidsByKey[costKey(vi)] = bidsByKey[costKey(vi)] || []).push({ vendor_id: vendorId, unit_cost: vi.unit_cost, can_supply: vi.can_supply, item_note: vi.item_note });
  });
  // All vendor RFQs become columns (submitted or not) so the UI can show per-item states.
  // rfq_id is included so CostingScreen can look up vendorItemBySource[rfq_id][source_item_id].
  const columns = vrfqs.map((v) => ({
    vendor_id: v.vendor_id,
    rfq_id: v.rfq_id,
    status: v.status,
    name: (vendorMap[v.vendor_id] || {}).name || 'Vendor',
  }));

  // Is the linked event completed/cancelled? → costing becomes view-only.
  let eventClosed = false;
  if (rfq && rfq.quotation_id) {
    try {
      const { data: q } = await supabase.from('quotations').select('event_id').eq('quotation_id', rfq.quotation_id).maybeSingle();
      if (q && q.event_id) { const { data: ev } = await supabase.from('events').select('status').eq('event_id', q.event_id).maybeSingle(); eventClosed = !!(ev && ['completed', 'cancelled'].includes((ev.status || '').toLowerCase())); }
    } catch (e) { eventClosed = false; }
  }

  return {
    rfq: rfq || null,
    clientItems: clientItems || [],
    bidsByKey, columns,
    vendorItemBySource,
    defaultMarkup: (settings && settings.default_markup_pct != null) ? Number(settings.default_markup_pct) : 30,
    draftQuoteId: rfq ? rfq.quotation_id : null,
    eventClosed,
    vrfqs,
  };
}

// Replace the draft quote's line items with the priced rows + recompute totals.
export async function generateQuoteFromCosting(draftQuoteId, rows) {
  if (!draftQuoteId) throw new Error('No draft quote to fill — approve the RFQ first.');
  const now = new Date().toISOString();
  await runDb(supabase.from('quotation_line_items').update({ is_deleted: true }).eq('quotation_id', draftQuoteId).eq('is_deleted', false), 'clear draft items');
  const li = rows.map((r, i) => ({
    quotation_id: draftQuoteId, sub_event_name: r.sub_event_name || null, description: r.description,
    quantity: r.quantity || 1, unit_price: r.clientUnitPrice || 0, amount: (r.clientUnitPrice || 0) * (r.quantity || 1),
    sort_order: i, sub_items: Array.isArray(r.sub_items) ? r.sub_items : [], is_deleted: false, created_at: now,
  }));
  if (li.length) { const { error } = await runDb(supabase.from('quotation_line_items').insert(li), 'price quote items'); if (error) throw error; }
  const subtotal = li.reduce((s, x) => s + (x.amount || 0), 0);
  const { error: qe } = await runDb(supabase.from('quotations').update({ subtotal, discount_amount: 0, grand_total: subtotal, updated_at: now }).eq('quotation_id', draftQuoteId), 'update quote total');
  if (qe) throw qe;
  return { subtotal };
}

// Suggest vendor engagements for an event from its saved costing summary.
// Groups the chosen (non-in-house) vendors across the costing lines and sums each
// one's winning item cost (chosen_cost × qty). Returns [{ vendor_id, name, amount, item_count }].
// Used by the event screen to offer "pull the costing's vendors into this event".
export async function loadCostingVendorSuggestion(quotationIds) {
  const ids = (quotationIds || []).filter(Boolean);
  if (!ids.length) return [];
  const { data: sums } = await supabase.from('costing_summaries')
    .select('*').in('quotation_id', ids).eq('is_deleted', false)
    .order('generated_at', { ascending: false });
  const summary = (sums || [])[0];
  if (!summary || !Array.isArray(summary.lines)) return [];
  const byVendor = {};
  summary.lines.forEach((ln) => {
    const vid = ln.chosen;
    if (!vid || vid === 'in-house') return;          // skip in-house / unpriced lines
    const cost = (ln.chosen_cost != null ? Number(ln.chosen_cost) : 0) * (Number(ln.quantity) || 1);
    if (!byVendor[vid]) byVendor[vid] = { vendor_id: vid, amount: 0, item_count: 0 };
    byVendor[vid].amount += cost;
    byVendor[vid].item_count += 1;
  });
  const vids = Object.keys(byVendor);
  if (!vids.length) return [];
  const { data: vendors } = await supabase.from('vendors').select('vendor_id,name').in('vendor_id', vids);
  const nameOf = {}; (vendors || []).forEach((v) => { nameOf[v.vendor_id] = v.name; });
  return vids.map((id) => ({ ...byVendor[id], name: nameOf[id] || 'Vendor' }));
}

// Save the audit snapshot (every bid, chosen source, markup, notes).
export async function saveCostingSummary(payload) {
  const uid = await _currentUid();
  const { error } = await runDb(supabase.from('costing_summaries').insert({
    client_rfq_id: payload.client_rfq_id, quotation_id: payload.quotation_id || null, event_id: payload.event_id || null,
    generated_by: uid || null, default_markup_pct: payload.default_markup_pct,
    total_cost: payload.total_cost, total_client: payload.total_client, total_margin: payload.total_margin,
    internal_notes: payload.internal_notes || null, lines: payload.lines || [], is_deleted: false,
  }), 'save costing summary');
  if (error) throw error;
  return true;
}
