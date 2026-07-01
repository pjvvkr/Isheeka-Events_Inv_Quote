// Sourcing-drift detection (PURE — no DB, no side effects, no business logic).
// Compares a quote's CURRENT line items against the sourcing basis captured in its
// latest costing snapshot, and reports whether scope has drifted (items added,
// rescoped, or removed) since vendors were priced.
//
// Sub-item aware: when the baseline snapshot retained `sub_items` it compares them,
// so a sub-item revamp under an unchanged main is flagged as "rescoped". For legacy
// snapshots that predate sub_items being stored, sub-item comparison is skipped so
// old quotes don't produce false positives.
//
// Known limitation (until a stable source_item_id lands on quote lines): identity is
// matched by (sub_event + description), so a RENAMED item reads as add + remove rather
// than a single "rescoped". That still flags drift correctly; it just over-counts.

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
const pick = (o, ...keys) => {
  for (const k of keys) { if (o && o[k] !== undefined && o[k] !== null) return o[k]; }
  return undefined;
};

// Accepts either a quote line ({sub_event_name, description, quantity, sub_items})
// or a costing-snapshot line ({sub_event, item, qty, sub_items?}).
export function normalizeLine(raw) {
  raw = raw || {};
  return {
    subEvent: norm(pick(raw, 'sub_event_name', 'sub_event')),
    desc: norm(pick(raw, 'description', 'item')),
    qty: norm(pick(raw, 'quantity', 'qty')),
    subItems: raw.sub_items,   // undefined => not captured (legacy snapshot)
  };
}

const identityKey = (n) => n.subEvent + '||' + n.desc;
const mainFp = (n) => n.subEvent + '::' + n.desc + '::' + n.qty;

// Sub-item fingerprint: sorted name~qty of each sub-item. Returns undefined when
// sub_items weren't captured, so the caller skips sub-item comparison for that side.
function subFp(subItems) {
  if (subItems === undefined) return undefined;
  const arr = Array.isArray(subItems) ? subItems : [];
  return arr
    .map((si) => norm(pick(si || {}, 'name')) + '~' + norm(pick(si || {}, 'qty', 'quantity')))
    .sort()
    .join('|');
}

// quoteLines vs baselineLines (the costing snapshot's `lines`). Returns:
//   { stale, changed, counts:{added,rescoped,removed,unchanged}, details:[{description,kind}] }
export function computeSourcingDrift(quoteLines, baselineLines) {
  const q = (quoteLines || []).map(normalizeLine);
  const b = (baselineLines || []).map(normalizeLine);
  const bById = {}; b.forEach((x) => { const k = identityKey(x); if (bById[k] === undefined) bById[k] = x; });
  const qById = {}; q.forEach((x) => { const k = identityKey(x); if (qById[k] === undefined) qById[k] = x; });

  let added = 0, rescoped = 0, removed = 0, unchanged = 0;
  const details = [];
  q.forEach((x) => {
    const base = bById[identityKey(x)];
    if (base === undefined) { added++; details.push({ description: x.desc, kind: 'new' }); return; }
    const mainChanged = mainFp(x) !== mainFp(base);
    const aSub = subFp(x.subItems), bSub = subFp(base.subItems);
    const subChanged = aSub !== undefined && bSub !== undefined && aSub !== bSub;
    if (mainChanged || subChanged) { rescoped++; details.push({ description: x.desc, kind: 'rescoped' }); }
    else unchanged++;
  });
  b.forEach((x) => { if (qById[identityKey(x)] === undefined) { removed++; details.push({ description: x.desc, kind: 'removed' }); } });

  const changed = added + rescoped + removed;
  return { stale: changed > 0, changed, counts: { added, rescoped, removed, unchanged }, details };
}

// "1 new, 2 changed, 1 removed" — for the warning banner.
export function driftSummary(counts) {
  if (!counts) return '';
  const parts = [];
  if (counts.added) parts.push(counts.added + ' new');
  if (counts.rescoped) parts.push(counts.rescoped + ' changed');
  if (counts.removed) parts.push(counts.removed + ' removed');
  return parts.join(', ');
}
