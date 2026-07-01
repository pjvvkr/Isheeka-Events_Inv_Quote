// PURE planner for syncing a client RFQ's items to the current (revised) quote.
// No DB, no side effects. Decides which rfq_items to insert / update / soft-delete so the
// sourcing basis matches the quote — while keeping stable rfq_item_ids for matched lines,
// so already-received vendor bids (which point at the client rfq_item_id) stay linked.
//
// Match is by source_item_id (= the client rfq_item_id for costed lines), falling back to
// (sub_event + description). Unchanged matches are left alone (bid preserved); changed ones
// are updated in place (same id, bid re-opens on the sourcing screen); quote lines with no
// match become inserts; rfq_items with no matching quote line become soft-deletes.

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
const key = (se, d) => norm(se) + '||' + norm(d);
const subSig = (arr) => (Array.isArray(arr) ? arr : [])
  .map((si) => norm(si && si.name) + '~' + norm(si && (si.qty != null ? si.qty : (si && si.quantity))))
  .sort().join('|');
const isChanged = (q, r) =>
  norm(q.description) !== norm(r.description) ||
  norm(q.quantity) !== norm(r.quantity) ||
  norm(q.sub_event_name) !== norm(r.sub_event_name) ||
  subSig(q.sub_items) !== subSig(r.sub_items);

export function planSourcingSync(quoteLines, rfqItems) {
  const q = quoteLines || [];
  const r = rfqItems || [];
  const rById = {}, rByKey = {};
  r.forEach((it) => {
    if (it.rfq_item_id) rById[it.rfq_item_id] = it;
    const k = key(it.sub_event_name, it.description);
    if (!(k in rByKey)) rByKey[k] = it;
  });

  const usedR = new Set();
  const inserts = [], updates = [];
  let added = 0, changed = 0, unchanged = 0;

  q.forEach((ql, i) => {
    let match = null;
    if (ql.source_item_id && rById[ql.source_item_id] && !usedR.has(ql.source_item_id)) {
      match = rById[ql.source_item_id];
    }
    if (!match) {
      const cand = rByKey[key(ql.sub_event_name, ql.description)];
      if (cand && cand.rfq_item_id && !usedR.has(cand.rfq_item_id)) match = cand;
    }
    if (match) {
      usedR.add(match.rfq_item_id);
      if (isChanged(ql, match)) {
        updates.push({ rfq_item_id: match.rfq_item_id, description: ql.description, quantity: ql.quantity, sub_event_name: ql.sub_event_name || null, sub_items: ql.sub_items || [] });
        changed++;
      } else unchanged++;
    } else {
      inserts.push({
        proposedId: ql.source_item_id || null,
        lineItemId: ql.line_item_id || null,
        description: ql.description, quantity: ql.quantity,
        sub_event_name: ql.sub_event_name || null, sub_items: ql.sub_items || [],
        sort_order: (ql.sort_order != null ? ql.sort_order : i),
      });
      added++;
    }
  });

  const removes = r.filter((it) => it.rfq_item_id && !usedR.has(it.rfq_item_id)).map((it) => it.rfq_item_id);
  return { inserts, updates, removes, counts: { added, changed, removed: removes.length, unchanged } };
}
