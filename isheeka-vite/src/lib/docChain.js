// Document-flow lifecycle resolver (READ-ONLY). Walks the existing FK links from any
// record (lead / rfq / quote / event / invoice) to assemble the chain for the DocFlow rail.
// Never throws: every query is wrapped, so partial/failed resolution just yields whatever
// was found and the rail degrades gracefully. No writes, no business logic.
import { supabase } from './supabase';
import { computeSourcingDrift } from './sourcingDrift.js';
import { staleVendorRfqs } from './sourcingSync.js';

const num = (n) => parseFloat(n) || 0;

export async function resolveDocChain(kind, id) {
  const out = {
    lead: null, clientRfq: null, quote: null, event: null, invoice: null,
    sourcing: { vendorTotal: 0, vendorSubmitted: 0, costingExists: false, stale: false, pricedAt: null },
    ar: null, ap: null,
  };
  if (!kind || !id) return out;

  const ids = { lead: null, rfq: null, quote: null, event: null, invoice: null };
  ids[kind] = id;

  const get1 = async (table, sel, col, val) => {
    if (!val) return null;
    try { const { data } = await supabase.from(table).select(sel).eq(col, val).maybeSingle(); return data || null; }
    catch (e) { return null; }
  };
  const find1 = async (table, sel, eqs, neqs) => {
    try {
      let q = supabase.from(table).select(sel).eq('is_deleted', false);
      (eqs || []).forEach(([c, v]) => { q = q.eq(c, v); });
      (neqs || []).forEach(([c, v]) => { q = q.neq(c, v); });
      const { data } = await q.order('created_at', { ascending: false }).limit(1);
      return (data && data[0]) || null;
    } catch (e) { return null; }
  };

  // ── resolve the spine ids by propagating links (a few passes) ──
  for (let p = 0; p < 3; p++) {
    if (ids.invoice && (!ids.event || !ids.quote)) { const r = await get1('invoices', 'event_id,quotation_id', 'invoice_id', ids.invoice); if (r) { ids.event = ids.event || r.event_id; ids.quote = ids.quote || r.quotation_id; } }
    if (ids.event && !ids.lead) { const r = await get1('events', 'lead_id', 'event_id', ids.event); if (r) ids.lead = ids.lead || r.lead_id; }
    if (ids.event && !ids.quote) { const r = await find1('quotations', 'quotation_id,lead_id', [['event_id', ids.event]]); if (r) { ids.quote = ids.quote || r.quotation_id; ids.lead = ids.lead || r.lead_id; } }
    if (ids.quote && (!ids.lead || !ids.event)) { const r = await get1('quotations', 'lead_id,event_id', 'quotation_id', ids.quote); if (r) { ids.lead = ids.lead || r.lead_id; ids.event = ids.event || r.event_id; } }
    if (ids.rfq && !ids.quote) { const r = await get1('rfqs', 'quotation_id,lead_id', 'rfq_id', ids.rfq); if (r) { ids.quote = ids.quote || r.quotation_id; ids.lead = ids.lead || r.lead_id; } }
    if (ids.lead && (!ids.quote || !ids.event)) { const r = await get1('leads', 'active_quotation_id,event_id', 'lead_id', ids.lead); if (r) { ids.quote = ids.quote || r.active_quotation_id; ids.event = ids.event || r.event_id; } }
    if (!ids.rfq && ids.quote) { const r = await find1('rfqs', 'rfq_id', [['quotation_id', ids.quote], ['party_type', 'client']], [['is_sourcing_anchor', true]]); if (r) ids.rfq = r.rfq_id; }
    if (!ids.rfq && ids.lead) { const r = await find1('rfqs', 'rfq_id', [['lead_id', ids.lead], ['party_type', 'client']], [['is_sourcing_anchor', true]]); if (r) ids.rfq = r.rfq_id; }
    if (ids.event && !ids.invoice) { const r = await find1('invoices', 'invoice_id', [['event_id', ids.event]], [['status', 'cancelled']]); if (r) ids.invoice = r.invoice_id; }
  }

  // ── load each node's display data ──
  out.lead = await get1('leads', 'lead_id,ref_number', 'lead_id', ids.lead);
  out.clientRfq = await get1('rfqs', 'rfq_id,ref_number,status', 'rfq_id', ids.rfq);
  out.quote = await get1('quotations', 'quotation_id,ref_number,status', 'quotation_id', ids.quote);
  out.event = await get1('events', 'event_id,ref_number,name,status', 'event_id', ids.event);
  out.invoice = await get1('invoices', 'invoice_id,ref_number,status,total_received,total_outstanding,grand_total', 'invoice_id', ids.invoice);

  // ── sourcing: vendor RFQs (count + submitted) hanging off the client/anchor RFQs ──
  let parents = [];
  try {
    if (ids.quote) { const { data } = await supabase.from('rfqs').select('rfq_id').eq('quotation_id', ids.quote).eq('party_type', 'client').eq('is_deleted', false); parents = (data || []).map((r) => r.rfq_id); }
    if (ids.rfq && !parents.includes(ids.rfq)) parents.push(ids.rfq);
  } catch (e) { /* noop */ }
  if (parents.length) {
    try {
      const { data } = await supabase.from('rfqs').select('status').eq('party_type', 'vendor').eq('is_deleted', false).in('parent_rfq_id', parents);
      out.sourcing.vendorTotal = (data || []).length;
      out.sourcing.vendorSubmitted = (data || []).filter((v) => v.status === 'submitted').length;
    } catch (e) { /* noop */ }
  }
  if (ids.quote) {
    try {
      // costingExists ("Priced"): was pricing done? Snapshots hang off the client RFQ
      // (shared across revisions); fall back to this quote's id.
      let costed = false;
      if (ids.rfq) { const { data } = await supabase.from('costing_summaries').select('generated_at').eq('client_rfq_id', ids.rfq).eq('is_deleted', false).order('generated_at', { ascending: false }).limit(1); if (data && data.length) { costed = true; out.sourcing.pricedAt = data[0].generated_at; } }
      if (!costed) { const { data } = await supabase.from('costing_summaries').select('generated_at').eq('quotation_id', ids.quote).eq('is_deleted', false).order('generated_at', { ascending: false }).limit(1); if (data && data.length) { costed = true; out.sourcing.pricedAt = data[0].generated_at; } }
      out.sourcing.costingExists = costed;
      // stale ("Re-source"): does the quote scope differ from the client RFQ's item list
      // (the live sourcing basis)? rfq_items always carry a sub_items array, so sub-item
      // edits are detected — unlike older costing snapshots that predate sub_items.
      if (costed && ids.rfq) {
        const [riRes, qlRes] = await Promise.all([
          supabase.from('rfq_items').select('rfq_item_id,description,quantity,sub_event_name,sub_items').eq('rfq_id', ids.rfq).eq('is_deleted', false),
          supabase.from('quotation_line_items').select('source_item_id,description,quantity,sub_event_name,sub_items').eq('quotation_id', ids.quote).eq('is_deleted', false),
        ]);
        const baseline = (riRes.data || []).map((r) => ({ ...r, source_item_id: r.rfq_item_id }));
        out.sourcing.stale = computeSourcingDrift(qlRes.data || [], baseline).stale;
        if (!out.sourcing.stale) {
          // second layer: a vendor's frozen items no longer match the (re-sourced) client items
          const { data: vr } = await supabase.from('rfqs').select('rfq_id').eq('parent_rfq_id', ids.rfq).eq('party_type', 'vendor').eq('is_deleted', false);
          const vids = (vr || []).map((x) => x.rfq_id);
          if (vids.length) {
            const { data: vitems } = await supabase.from('rfq_items').select('rfq_id,source_item_id,description,quantity,sub_items').in('rfq_id', vids).eq('is_deleted', false);
            out.sourcing.stale = staleVendorRfqs(riRes.data || [], vitems || []).length > 0;
          }
        }
      }
    } catch (e) { /* noop */ }
  }

  // ── AR (from the active invoice) + AP (vendor dues on the event) ──
  if (out.invoice) {
    const grand = num(out.invoice.grand_total), received = num(out.invoice.total_received);
    const outstanding = out.invoice.total_outstanding != null ? num(out.invoice.total_outstanding) : Math.max(0, grand - received);
    out.ar = { grand, received, outstanding, status: out.invoice.status };
  }
  if (ids.event) {
    try {
      const { data } = await supabase.from('event_vendors').select('outstanding').eq('event_id', ids.event).eq('is_deleted', false);
      out.ap = { count: (data || []).length, outstanding: (data || []).reduce((s, v) => s + num(v.outstanding), 0) };
    } catch (e) { out.ap = { count: 0, outstanding: 0 }; }
  } else { out.ap = { count: 0, outstanding: 0 }; }

  return out;
}
