// Pure unit tests for the sourcing-sync planner (no Supabase, no DOM).
import { describe, it, expect } from 'vitest';
import { planSourcingSync } from '../../src/lib/sourcingSync.js';

// quote line (quotation_line_items) and client rfq item (rfq_items)
const ql = (sid, desc, qty, subs, se, lid) => ({ source_item_id: sid, line_item_id: lid || null, description: desc, quantity: qty, sub_event_name: se || '', sub_items: subs || [] });
const ri = (id, desc, qty, subs, se) => ({ rfq_item_id: id, description: desc, quantity: qty, sub_event_name: se || '', sub_items: subs || [] });

describe('planSourcingSync', () => {
  it('no-op when the quote already matches the rfq items', () => {
    const p = planSourcingSync([ql('a', 'Stage', 1), ql('b', 'Lights', 2)], [ri('a', 'Stage', 1), ri('b', 'Lights', 2)]);
    expect(p.counts).toEqual({ added: 0, changed: 0, removed: 0, unchanged: 2 });
    expect(p.inserts).toHaveLength(0); expect(p.updates).toHaveLength(0); expect(p.removes).toHaveLength(0);
  });

  it('updates a changed line in place (keeps the rfq_item_id so bids stay linked)', () => {
    const p = planSourcingSync([ql('a', 'Stage', 3)], [ri('a', 'Stage', 1)]);
    expect(p.counts.changed).toBe(1);
    expect(p.updates[0].rfq_item_id).toBe('a');
    expect(p.updates[0].quantity).toBe(3);
    expect(p.removes).toHaveLength(0);
  });

  it('treats a rename as an in-place update when the id matches (not add+remove)', () => {
    const p = planSourcingSync([ql('a', 'Main stage', 1)], [ri('a', 'Stage', 1)]);
    expect(p.counts).toMatchObject({ added: 0, changed: 1, removed: 0 });
    expect(p.updates[0].rfq_item_id).toBe('a');
  });

  it('inserts a genuinely new line, proposing its source_item_id as the id', () => {
    const p = planSourcingSync([ql('a', 'Stage', 1), ql('new-uuid', 'Fog', 1)], [ri('a', 'Stage', 1)]);
    expect(p.counts.added).toBe(1);
    expect(p.inserts[0]).toMatchObject({ proposedId: 'new-uuid', description: 'Fog' });
  });

  it('soft-deletes an rfq item the quote no longer has', () => {
    const p = planSourcingSync([ql('a', 'Stage', 1)], [ri('a', 'Stage', 1), ri('b', 'Lights', 2)]);
    expect(p.removes).toEqual(['b']);
    expect(p.counts.removed).toBe(1);
  });

  it('detects a sub-item change as a change', () => {
    const p = planSourcingSync(
      [ql('a', 'Catering', 1, [{ name: 'Veg', qty: 50 }, { name: 'Non-veg', qty: 30 }])],
      [ri('a', 'Catering', 1, [{ name: 'Veg', qty: 50 }])]
    );
    expect(p.counts.changed).toBe(1);
  });

  it('falls back to sub_event+description when a line has no source_item_id', () => {
    const p = planSourcingSync([ql(null, 'Stage', 1)], [ri('a', 'Stage', 1)]);
    expect(p.counts.unchanged).toBe(1);
    expect(p.inserts).toHaveLength(0);
  });

  it('carries line_item_id on inserts so the executor can relink the quote line', () => {
    const p = planSourcingSync([ql(null, 'Fog', 1, [], '', 'LI-9')], []);
    expect(p.inserts[0]).toMatchObject({ lineItemId: 'LI-9', proposedId: null });
  });

  it('handles empty inputs', () => {
    expect(planSourcingSync([], []).counts).toEqual({ added: 0, changed: 0, removed: 0, unchanged: 0 });
    expect(planSourcingSync(null, null).counts.added).toBe(0);
  });
});
