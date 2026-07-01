// READ-ONLY: assemble a single "sourcing & pricing history" timeline for a deal by merging
// the meaningful decision points across tables — quote revisions, costing runs (with the
// client-total delta run-to-run), and vendor-RFQ / re-source activity. Never throws; a failed
// query just contributes nothing. No writes, no business logic.
import { supabase } from './supabase';

const inr = (n) => '₹' + Math.round(parseFloat(n) || 0).toLocaleString('en-IN');
const pct = (n) => (Math.round((parseFloat(n) || 0) * 10) / 10) + '%';

export async function loadDealHistory(quotationId) {
  if (!quotationId) return [];
  const entries = [];

  // revision lineage (client RFQ + costing hang off an earlier revision after a revise)
  const lineage = [];
  try {
    let cur = quotationId; const seen = new Set();
    for (let i = 0; i < 20 && cur && !seen.has(cur); i++) {
      seen.add(cur); lineage.push(cur);
      const { data } = await supabase.from('quotations').select('parent_quotation_id').eq('quotation_id', cur).maybeSingle();
      cur = data ? data.parent_quotation_id : null;
    }
  } catch (e) { /* noop */ }
  if (!lineage.length) lineage.push(quotationId);

  // actor names
  const userName = {};
  try { const { data } = await supabase.from('users').select('user_id,first_name,last_name'); (data || []).forEach((u) => { userName[u.user_id] = ((u.first_name || '') + ' ' + (u.last_name || '')).trim(); }); } catch (e) { /* noop */ }
  const who = (id) => (id && userName[id]) || 'Staff';

  // quote revisions
  try {
    const { data } = await supabase.from('quotations').select('ref_number,revision_number,grand_total,status,created_at').in('quotation_id', lineage).eq('is_deleted', false);
    (data || []).forEach((q) => entries.push({
      ts: q.created_at, kind: 'quote', icon: '📋',
      title: 'Quote ' + (q.ref_number || '') + (q.revision_number ? (' · rev ' + q.revision_number) : ' · original'),
      detail: inr(q.grand_total) + ' · ' + (q.status || ''), actor: '',
    }));
  } catch (e) { /* noop */ }

  // client RFQ = the sourcing basis
  let clientRfqId = null;
  try { const { data } = await supabase.from('rfqs').select('rfq_id').eq('party_type', 'client').eq('is_deleted', false).in('quotation_id', lineage).order('created_at', { ascending: false }).limit(1); clientRfqId = (data && data[0] && data[0].rfq_id) || null; } catch (e) { /* noop */ }

  if (clientRfqId) {
    // costing runs (ascending so we can show the run-to-run client delta)
    try {
      const { data } = await supabase.from('costing_summaries').select('generated_at,generated_by,total_cost,total_client,total_margin,default_markup_pct').eq('client_rfq_id', clientRfqId).eq('is_deleted', false).order('generated_at', { ascending: true });
      let prev = null;
      (data || []).forEach((cs) => {
        const marginPct = (parseFloat(cs.total_client) > 0) ? (parseFloat(cs.total_margin) / parseFloat(cs.total_client) * 100) : 0;
        let delta = '';
        if (prev) { const dc = (parseFloat(cs.total_client) || 0) - (parseFloat(prev.total_client) || 0); if (Math.abs(dc) >= 1) delta = ' · client ' + (dc > 0 ? '▲' : '▼') + inr(Math.abs(dc)); }
        entries.push({
          ts: cs.generated_at, kind: 'costing', icon: '🧮', title: 'Costing priced',
          detail: 'client ' + inr(cs.total_client) + ' · cost ' + inr(cs.total_cost) + ' · margin ' + pct(marginPct) + ' · markup ' + pct(cs.default_markup_pct) + delta,
          actor: who(cs.generated_by),
        });
        prev = cs;
      });
    } catch (e) { /* noop */ }

    // vendor RFQ + re-source activity (meaningful actions only, no reminder/link noise)
    try {
      const { data: vrfqs } = await supabase.from('rfqs').select('rfq_id,vendor_id').eq('parent_rfq_id', clientRfqId).eq('party_type', 'vendor');
      const vendorOf = {}; (vrfqs || []).forEach((v) => { vendorOf[v.rfq_id] = v.vendor_id; });
      const vnames = {};
      try { const ids = [...new Set((vrfqs || []).map((v) => v.vendor_id).filter(Boolean))]; if (ids.length) { const { data: vn } = await supabase.from('vendors').select('vendor_id,name').in('vendor_id', ids); (vn || []).forEach((x) => { vnames[x.vendor_id] = x.name; }); } } catch (e) { /* noop */ }
      const rfqIds = [clientRfqId, ...(vrfqs || []).map((v) => v.rfq_id)];
      const { data: acts } = await supabase.from('rfq_activity').select('rfq_id,actor,action,notes,created_at').in('rfq_id', rfqIds).in('action', ['created', 'rescoped', 'changes_requested', 'submitted']);
      const LABEL = { created: 'Vendor RFQ sent', rescoped: 'Sourcing rescoped', changes_requested: 'Changes requested', submitted: 'Vendor bid received' };
      const ICON = { created: '📨', rescoped: '🔄', changes_requested: '↩️', submitted: '💬' };
      (acts || []).forEach((a) => {
        const vid = vendorOf[a.rfq_id]; const vname = vid ? (vnames[vid] || 'Vendor') : '';
        entries.push({
          ts: a.created_at, kind: 'vendor', icon: ICON[a.action] || '📨',
          title: LABEL[a.action] || a.action, detail: vname || a.notes || '', actor: who(a.actor),
        });
      });
    } catch (e) { /* noop */ }
  }

  entries.sort((x, y) => new Date(y.ts) - new Date(x.ts));
  return entries;
}
