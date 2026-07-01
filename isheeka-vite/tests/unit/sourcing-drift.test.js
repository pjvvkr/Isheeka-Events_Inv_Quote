// Pure unit tests for the sourcing-drift detector (no Supabase, no DOM).
import { describe, it, expect } from 'vitest';
import { computeSourcingDrift, driftSummary } from '../../src/lib/sourcingDrift.js';

// quote line shape (quotation_line_items) and snapshot line shape (costing_summaries.lines)
const qline = (desc, qty, subs, se, sid) => { const o = { sub_event_name: se || '', description: desc, quantity: qty, sub_items: subs || [] }; if (sid !== undefined) o.source_item_id = sid; return o; };
const bline = (desc, qty, subs, se, sid) => { const o = { sub_event: se || '', item: desc, qty }; if (subs !== undefined) o.sub_items = subs; if (sid !== undefined) o.source_item_id = sid; return o; };

describe('computeSourcingDrift', () => {
  it('no drift when the quote matches the snapshot', () => {
    const base = [bline('Stage', 1, []), bline('Lights', 2, [])];
    const quote = [qline('Stage', 1, []), qline('Lights', 2, [])];
    const d = computeSourcingDrift(quote, base);
    expect(d.stale).toBe(false);
    expect(d.counts).toEqual({ added: 0, rescoped: 0, removed: 0, unchanged: 2 });
  });

  it('flags a newly added item', () => {
    const d = computeSourcingDrift([qline('Stage', 1, []), qline('Fog machine', 1, [])], [bline('Stage', 1, [])]);
    expect(d.stale).toBe(true);
    expect(d.counts.added).toBe(1);
  });

  it('flags a removed item', () => {
    const d = computeSourcingDrift([qline('Stage', 1, [])], [bline('Stage', 1, []), bline('Lights', 2, [])]);
    expect(d.counts.removed).toBe(1);
    expect(d.stale).toBe(true);
  });

  it('flags a quantity change as rescoped', () => {
    const d = computeSourcingDrift([qline('Chairs', 150, [])], [bline('Chairs', 100, [])]);
    expect(d.counts.rescoped).toBe(1);
    expect(d.stale).toBe(true);
  });

  it('flags a sub-item change when the baseline retained sub_items', () => {
    const base = [bline('Catering', 1, [{ name: 'Veg', qty: 50 }])];
    const quote = [qline('Catering', 1, [{ name: 'Veg', qty: 50 }, { name: 'Non-veg', qty: 30 }])];
    const d = computeSourcingDrift(quote, base);
    expect(d.counts.rescoped).toBe(1);
    expect(d.stale).toBe(true);
  });

  it('flags a sub-item added to a line whose baseline had an empty array (not legacy undefined)', () => {
    const base = [bline('Stage Lighting', 1, [])];
    const quote = [qline('Stage Lighting', 1, [{ name: 'Extra par cans', qty: 20 }])];
    const d = computeSourcingDrift(quote, base);
    expect(d.counts.rescoped).toBe(1);
    expect(d.stale).toBe(true);
  });

  it('ignores sub-items when the baseline predates sub_items (no false positive)', () => {
    const base = [bline('Catering', 1, undefined)]; // legacy snapshot: no sub_items key
    const quote = [qline('Catering', 1, [{ name: 'Veg', qty: 50 }])];
    const d = computeSourcingDrift(quote, base);
    expect(d.stale).toBe(false);
    expect(d.counts.unchanged).toBe(1);
  });

  it('treats a rename as add + remove when there is no stable id', () => {
    const d = computeSourcingDrift([qline('DJ & sound', 1, [])], [bline('DJ', 1, [])]);
    expect(d.counts.added).toBe(1);
    expect(d.counts.removed).toBe(1);
    expect(d.stale).toBe(true);
  });

  it('detects a rename as rescoped when the stable id matches (v2)', () => {
    const base = [bline('DJ', 1, [], '', 'id-1')];
    const quote = [qline('DJ & sound', 1, [], '', 'id-1')];
    const d = computeSourcingDrift(quote, base);
    expect(d.counts).toEqual({ added: 0, rescoped: 1, removed: 0, unchanged: 0 });
  });

  it('id match wins over string position (reordered + renamed lines)', () => {
    const base = [bline('Stage', 1, [], '', 'a'), bline('Lights', 2, [], '', 'b')];
    const quote = [qline('Lights', 2, [], '', 'b'), qline('Main stage', 1, [], '', 'a')];
    const d = computeSourcingDrift(quote, base);
    expect(d.counts).toEqual({ added: 0, rescoped: 1, removed: 0, unchanged: 1 });
  });

  it('does not flag a sub-item order change (order-insensitive)', () => {
    const base = [bline('Decor', 1, [{ name: 'Flowers', qty: 10 }, { name: 'Drapes', qty: 5 }])];
    const quote = [qline('Decor', 1, [{ name: 'Drapes', qty: 5 }, { name: 'Flowers', qty: 10 }])];
    expect(computeSourcingDrift(quote, base).stale).toBe(false);
  });

  it('handles empty inputs safely', () => {
    expect(computeSourcingDrift([], []).stale).toBe(false);
    expect(computeSourcingDrift(null, null).stale).toBe(false);
  });
});

describe('driftSummary', () => {
  it('formats counts', () => {
    expect(driftSummary({ added: 1, rescoped: 2, removed: 0 })).toBe('1 new, 2 changed');
    expect(driftSummary({ added: 0, rescoped: 0, removed: 3 })).toBe('3 removed');
  });
});
