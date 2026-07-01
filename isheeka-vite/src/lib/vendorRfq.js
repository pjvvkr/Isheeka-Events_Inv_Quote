// Milestone S · S2a — vendor RFQ logic.
// A vendor RFQ is an `rfqs` row with party_type='vendor', parent_rfq_id (the client RFQ
// it sources) and vendor_id. It reuses the client RFQ token/PIN machinery and the same
// public portal link (the gateway detects vendor mode by party_type). See
// docs/milestone-s-vendor-rfq-spec.md §3-§4.
import { supabase } from './supabase';
import { runDb } from './toast.jsx';
import { _currentUid } from './session.js';
import { getNextRfqRef } from './refs.js';
import { sha256Hex, genRfqToken, genRfqPin, rfqLink, createRfq } from './rfq.js';
import { planSourcingSync } from './sourcingSync.js';

// Spin up one vendor RFQ per selected vendor from an (approved) client RFQ.
// Freezes the client RFQ's item list as the sourcing basis (copied item-for-item,
// costs blank). Returns [{ vendor_id, vendor_name, rfq_id, ref_number, token, pin }].
// Optional: pass selectedItems (array of rfq_item rows) to scope to a subset;
// each vendor rfq_item gets source_item_id set to the client rfq_item's rfq_item_id.
export async function createVendorRfqs(parentRfq, vendors, selectedItems) {
  if (!parentRfq || !parentRfq.rfq_id) throw new Error('parent RFQ required');
  const list = (vendors || []).filter((v) => v && v.vendor_id);
  if (!list.length) return [];
  const uid = await _currentUid();

  // Freeze the parent's item list (the sourcing basis), or use caller-supplied subset.
  let baseItems;
  if (selectedItems && selectedItems.length > 0) {
    baseItems = selectedItems;
  } else {
    const { data: parentItems } = await supabase.from('rfq_items')
      .select('rfq_item_id,sub_event_name,description,quantity,unit,source,sort_order,sub_items')
      .eq('rfq_id', parentRfq.rfq_id).eq('is_deleted', false).order('sort_order');
    baseItems = parentItems || [];
  }

  const out = [];
  for (const v of list) {
    const ref_number = await getNextRfqRef();
    const token = genRfqToken();
    const pin = genRfqPin();
    const now = new Date().toISOString();
    const { data: rfq, error } = await runDb(supabase.from('rfqs').insert({
      ref_number, status: 'sent', party_type: 'vendor',
      parent_rfq_id: parentRfq.rfq_id, vendor_id: v.vendor_id,
      // vendor's own contact — never the client's identity
      contact_name: v.contact_person || v.name || null,
      contact_phone: v.phone_1 || null, contact_email: v.email_1 || null,
      // event basics copied from the client RFQ so the vendor has context
      event_type: parentRfq.event_type || null, event_date: parentRfq.event_date || null,
      location: parentRfq.location || null, city: parentRfq.city || null,
      access_mode: 'pin',
      access_pin_hash: await sha256Hex(pin),
      token_hash: await sha256Hex(token),
      token_expires_at: new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString(),
      created_by: uid || null, created_at: now, updated_at: now, is_deleted: false,
    }).select('rfq_id,ref_number').single(), 'create vendor RFQ');
    if (error || !rfq) throw error || new Error('vendor RFQ create failed');

    if (baseItems.length) {
      const rows = baseItems.map((it, i) => ({
        rfq_id: rfq.rfq_id, sub_event_name: it.sub_event_name || null,
        description: it.description, quantity: it.quantity ?? 1, unit: it.unit || null,
        source: it.source || 'custom', sort_order: it.sort_order ?? i,
        source_item_id: it.rfq_item_id || null,   // back-link to the client rfq_item
        sub_items: it.sub_items || [],
        can_supply: true, is_deleted: false, created_at: now,
      }));
      await runDb(supabase.from('rfq_items').insert(rows), 'copy items to vendor RFQ');
    }
    try { await supabase.from('rfq_activity').insert({ rfq_id: rfq.rfq_id, actor: uid || 'staff', action: 'created', notes: 'Vendor RFQ → ' + (v.name || '') }); } catch (e) { /* non-fatal */ }
    out.push({ vendor_id: v.vendor_id, vendor_name: v.name || '', rfq_id: rfq.rfq_id, ref_number: rfq.ref_number, token, pin });
  }
  return out;
}

// Universal sourcing bridge: ensure a quote has a client-RFQ to source against.
// Reuses the quote's existing client RFQ if it has one; otherwise creates a hidden
// "sourcing anchor" (is_sourcing_anchor=true, status=converted) seeded from the
// quote's line items, so the Sourcing panel + costing screen work off any quote.
// Returns the rfq_id to open. Idempotent per quote.
export async function ensureSourcingAnchor(quote) {
  if (!quote || !quote.quotation_id) throw new Error('No quote to source from.');
  const { data: existing } = await supabase.from('rfqs')
    .select('rfq_id').eq('party_type', 'client').eq('quotation_id', quote.quotation_id).eq('is_deleted', false)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (existing && existing.rfq_id) return existing.rfq_id;

  const { data: li } = await supabase.from('quotation_line_items')
    .select('description,quantity,sub_event_name,sort_order,sub_items').eq('quotation_id', quote.quotation_id).eq('is_deleted', false).order('sort_order');
  if (!li || !li.length) throw new Error('Add at least one line item before sourcing vendors.');

  const created = await createRfq({ client_id: quote.client_id || null, lead_id: quote.lead_id || null, contact_name: quote.client_name || null, event_type: quote.event_type || null });
  const { error: ue } = await runDb(supabase.from('rfqs').update({ status: 'converted', party_type: 'client', is_sourcing_anchor: true, quotation_id: quote.quotation_id, updated_at: new Date().toISOString() }).eq('rfq_id', created.rfq_id), 'link sourcing anchor');
  if (ue) throw ue;
  const items = li.map((x, i) => ({ rfq_id: created.rfq_id, description: x.description, quantity: x.quantity || 1, sub_event_name: x.sub_event_name || null, sort_order: (x.sort_order != null ? x.sort_order : i), source: 'quote', sub_items: x.sub_items || [], is_deleted: false }));
  const { error: lie } = await runDb(supabase.from('rfq_items').insert(items), 'seed sourcing items');
  if (lie) throw lie;
  return created.rfq_id;
}

// All vendor RFQs under a client RFQ (for the Sourcing panel).
export async function loadVendorRfqs(parentRfqId) {
  const { data } = await supabase.from('rfqs')
    .select('rfq_id,ref_number,status,vendor_id,reminder_count,last_reminded_at,client_submitted_at,updated_at,revision_number')
    .eq('parent_rfq_id', parentRfqId).eq('party_type', 'vendor').eq('is_deleted', false)
    .order('created_at', { ascending: true });
  return data || [];
}

// A vendor RFQ's items + cost state (for "View bid" + the priced/can't-supply summary).
export async function loadVendorRfqItems(rfqId) {
  const { data } = await supabase.from('rfq_items')
    .select('rfq_item_id,sub_event_name,description,quantity,unit,unit_cost,can_supply,item_note,sort_order,sub_items')
    .eq('rfq_id', rfqId).eq('is_deleted', false).order('sort_order');
  return data || [];
}

// Manual reminder: bump the counter + timestamp + log it (the UI then opens WhatsApp/email).
export async function bumpReminder(rfqId) {
  const { data: cur } = await supabase.from('rfqs').select('reminder_count').eq('rfq_id', rfqId).maybeSingle();
  const n = ((cur && cur.reminder_count) || 0) + 1;
  await runDb(supabase.from('rfqs').update({ reminder_count: n, last_reminded_at: new Date().toISOString() }).eq('rfq_id', rfqId), 'log reminder');
  try { const uid = await _currentUid(); await supabase.from('rfq_activity').insert({ rfq_id: rfqId, actor: uid || 'staff', action: 'reminded', notes: 'Reminder #' + n }); } catch (e) { /* non-fatal */ }
  return n;
}

// Issue a fresh token+PIN for a vendor RFQ (only the hash is stored, so re-sharing a
// reminder needs a new working link). Old link stops working. Returns { token, pin }.
export async function regenerateVendorLink(rfqId) {
  const token = genRfqToken();
  const pin = genRfqPin();
  const { error } = await runDb(supabase.from('rfqs').update({
    token_hash: await sha256Hex(token), access_pin_hash: await sha256Hex(pin),
    token_expires_at: new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('rfq_id', rfqId), 'regenerate vendor link');
  if (error) throw error;
  return { token, pin };
}

// Remove a vendor from sourcing: soft-delete its vendor RFQ so it drops from the
// sourcing list and the costing grid. Frees the vendor to be re-sent later.
export async function removeVendorRfq(rfqId) {
  const uid = await _currentUid();
  const { error } = await runDb(supabase.from('rfqs').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('rfq_id', rfqId), 'remove vendor RFQ');
  if (error) throw error;
  try { await supabase.from('rfq_activity').insert({ rfq_id: rfqId, actor: uid || 'staff', action: 'withdrawn', notes: 'Removed from sourcing' }); } catch (e) { /* non-fatal */ }
}

// Re-scope a vendor RFQ to a corrected item set: replace its frozen items, clear costs,
// reset to 'sent', mint a fresh link+PIN (old link dies), bump revision_number, log it.
// Costing reads vendor items live, so the revised bid flows in once re-submitted.
// Returns { token, pin, ref_number } for re-sharing.
export async function rescopeVendorRfq(vendorRfq, parentRfq, selectedItems) {
  if (!vendorRfq || !vendorRfq.rfq_id) throw new Error('vendor RFQ required');
  const items = (selectedItems || []).filter((it) => it && (it.description || '').trim());
  if (!items.length) throw new Error('Select at least one item.');
  const uid = await _currentUid();
  const now = new Date().toISOString();
  await runDb(supabase.from('rfq_items').delete().eq('rfq_id', vendorRfq.rfq_id), 'clear vendor items');
  const rows = items.map((it, i) => ({
    rfq_id: vendorRfq.rfq_id, sub_event_name: it.sub_event_name || null,
    description: it.description, quantity: it.quantity ?? 1, unit: it.unit || null,
    source: it.source || 'custom', sort_order: it.sort_order ?? i,
    source_item_id: it.rfq_item_id || null, sub_items: it.sub_items || [],
    can_supply: true, is_deleted: false, created_at: now,
  }));
  await runDb(supabase.from('rfq_items').insert(rows), 'set revised vendor items');
  const token = genRfqToken();
  const pin = genRfqPin();
  const { error } = await runDb(supabase.from('rfqs').update({
    status: 'sent', token_hash: await sha256Hex(token), access_pin_hash: await sha256Hex(pin),
    token_expires_at: new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString(),
    client_submitted_at: null, revision_number: (vendorRfq.revision_number || 0) + 1,
    reminder_count: 0, updated_at: now,
  }).eq('rfq_id', vendorRfq.rfq_id), 'rescope vendor RFQ');
  if (error) throw error;
  try { await supabase.from('rfq_activity').insert({ rfq_id: vendorRfq.rfq_id, actor: uid || 'staff', action: 'rescoped', notes: 'Items revised — ' + items.length + ' item' + (items.length > 1 ? 's' : '') }); } catch (e) { /* non-fatal */ }
  return { token, pin, ref_number: vendorRfq.ref_number };
}

// The vendor opens the SAME portal link; the gateway renders vendor mode by party_type.
export function vendorRfqLink(token) { return rfqLink(token); }

// WhatsApp/email body for a vendor RFQ send or reminder.
export function buildVendorRfqMsg(vendorRfq, settings, link, opts = {}) {
  const company = (settings && settings.company_name) || 'Isheeka Events';
  const lead = opts.reminder ? 'Gentle reminder — your pricing is awaited.\n\n' : '';
  return lead
    + 'Hello' + (vendorRfq.vendor_name ? ' ' + vendorRfq.vendor_name : '') + ',\n\n'
    + company + ' would like your pricing for an upcoming event. Please open the secure link '
    + 'and enter your unit cost for each item (or mark any you can\'t supply):\n\n'
    + link + '\n'
    + (vendorRfq.pin ? ('Access PIN: ' + vendorRfq.pin + '\n') : '')
    + '\nThank you,\n' + company;
}

// v3 guided re-source: sync a client RFQ's items to the current quote. Keeps stable
// rfq_item_ids for matched lines (so received vendor bids stay linked), inserts new lines
// (reusing the quote line's source_item_id as the id when free, else relinking the quote
// line to the generated id), and soft-deletes lines the quote no longer has. No vendor
// messages are sent here — that stays a manual step on the sourcing screen. Returns counts.
export async function applySourcingSync(clientRfqId, quotationId) {
  if (!clientRfqId || !quotationId) return { added: 0, changed: 0, removed: 0, unchanged: 0 };
  const [activeRes, allRes, qlRes] = await Promise.all([
    supabase.from('rfq_items').select('rfq_item_id,description,quantity,sub_event_name,sub_items').eq('rfq_id', clientRfqId).eq('is_deleted', false),
    supabase.from('rfq_items').select('rfq_item_id').eq('rfq_id', clientRfqId),
    supabase.from('quotation_line_items').select('line_item_id,source_item_id,description,quantity,sub_event_name,sub_items,sort_order').eq('quotation_id', quotationId).eq('is_deleted', false).order('sort_order'),
  ]);
  const plan = planSourcingSync(qlRes.data || [], activeRes.data || []);
  const knownIds = new Set((allRes.data || []).map((x) => x.rfq_item_id));
  const now = new Date().toISOString();

  for (const ins of plan.inserts) {
    const useId = ins.proposedId && !knownIds.has(ins.proposedId) ? ins.proposedId : null;
    const row = { rfq_id: clientRfqId, description: ins.description, quantity: ins.quantity || 1, sub_event_name: ins.sub_event_name || null, sort_order: ins.sort_order != null ? ins.sort_order : 0, source: 'quote', sub_items: ins.sub_items || [], is_deleted: false, created_at: now };
    if (useId) row.rfq_item_id = useId;
    const { data: created, error } = await runDb(supabase.from('rfq_items').insert(row).select('rfq_item_id').single(), 'add sourced item');
    if (error || !created) continue;
    knownIds.add(created.rfq_item_id);
    // If we could not reuse the quote line's id, relink the quote line so future syncs match.
    if (!useId && ins.lineItemId) {
      await runDb(supabase.from('quotation_line_items').update({ source_item_id: created.rfq_item_id }).eq('line_item_id', ins.lineItemId), 'relink quote line');
    }
  }
  for (const u of plan.updates) {
    await runDb(supabase.from('rfq_items').update({ description: u.description, quantity: u.quantity || 1, sub_event_name: u.sub_event_name || null, sub_items: u.sub_items || [], updated_at: now }).eq('rfq_item_id', u.rfq_item_id), 'update sourced item');
  }
  if (plan.removes.length) {
    await runDb(supabase.from('rfq_items').update({ is_deleted: true, updated_at: now }).in('rfq_item_id', plan.removes), 'remove sourced items');
  }
  const changed = plan.counts.added + plan.counts.changed + plan.counts.removed;
  if (changed > 0) {
    try {
      const bits = [plan.counts.added ? (plan.counts.added + ' added') : null, plan.counts.changed ? (plan.counts.changed + ' changed') : null, plan.counts.removed ? (plan.counts.removed + ' removed') : null].filter(Boolean).join(', ');
      const uid = await _currentUid();
      await supabase.from('rfq_activity').insert({ rfq_id: clientRfqId, actor: uid || 'staff', action: 'rescoped', notes: 'Re-sourced from quote: ' + bits });
    } catch (e) { /* non-fatal */ }
  }
  return plan.counts;
}
