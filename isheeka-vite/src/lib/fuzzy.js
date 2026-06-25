// Lightweight fuzzy name matching for de-duplicating short names (event types,
// lead sources). No dependencies — Dice coefficient over character bigrams.

// Slug used as the stored `value` (matches the existing single-add behaviour).
export function slugify(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Comparison key: lowercase, &→and, strip punctuation, collapse spaces,
// singularise a trailing "s" on each word (so "birthdays" ≈ "birthday").
export function normalizeName(s) {
  const x = String(s || '').toLowerCase().trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return x.split(' ').map((w) => (w.length > 3 && w.endsWith('s')) ? w.slice(0, -1) : w).join(' ');
}

function bigrams(s) {
  const t = s.replace(/\s/g, '');
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

// Similarity 0..1 between two names (after normalisation). 1 = identical.
export function similarity(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na), bb = bigrams(nb);
  if (!ba.length || !bb.length) return 0;
  const map = new Map();
  ba.forEach((g) => map.set(g, (map.get(g) || 0) + 1));
  let inter = 0;
  bb.forEach((g) => { const c = map.get(g) || 0; if (c > 0) { inter++; map.set(g, c - 1); } });
  return (2 * inter) / (ba.length + bb.length);
}

export const SIMILAR_THRESHOLD = 0.72;   // ≥ this (and < 1) → flag as "similar"

// Best match for a candidate against existing [{label, value, is_active}].
// Returns { score, match }. score 1 = exact (normalised label OR same value slug).
export function bestNameMatch(candidate, existing) {
  const cn = normalizeName(candidate);
  const cv = slugify(candidate);
  let best = { score: 0, match: null };
  for (const e of (existing || [])) {
    let s = similarity(candidate, e.label || '');
    if (cn === normalizeName(e.value || '') || (cv && cv === (e.value || ''))) s = 1;
    if (s > best.score) best = { score: s, match: e };
  }
  return best;
}
