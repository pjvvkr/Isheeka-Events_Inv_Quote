// Milestone S · S3 — Costing & markup screen. Compares submitted vendor bids per item,
// auto-picks the cheapest, applies markup (default + per-item override), and produces a
// priced draft quote + a saved costing summary. See docs/milestone-s-vendor-rfq-spec.md.
import React from 'react';
import { notify } from '../lib/toast.jsx';
import { loadCostingData, generateQuoteFromCosting, saveCostingSummary, costKey } from '../lib/costing.js';

const MARGIN_FLOOR_PCT = 15; // soft-warning threshold (spec §5 #5)

export function CostingScreen({ rfqId, onBack, onNavigate }) {
  const [d, setD] = React.useState(null);
  const [rows, setRows] = React.useState([]);
  const [internalNotes, setInternalNotes] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [warn, setWarn] = React.useState(null);

  React.useEffect(() => { (async () => {
    setLoading(true);
    const data = await loadCostingData(rfqId);
    setD(data);
    const rs = (data.clientItems || []).map((it) => {
      const bids = data.bidsByKey[costKey(it)] || [];
      let chosen = null, best = Infinity;
      bids.forEach((b) => { if (b.can_supply !== false && b.unit_cost != null && Number(b.unit_cost) < best) { best = Number(b.unit_cost); chosen = b.vendor_id; } });
      return { key: costKey(it), sub_event_name: it.sub_event_name || '', description: it.description, quantity: Number(it.quantity) || 1, bids, inHouse: false, inHouseCost: '', chosen, markup: data.defaultMarkup, markupOverridden: false, autoCheapest: chosen };
    });
    setRows(rs);
    setLoading(false);
  })(); }, [rfqId]);

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const chosenCostOf = (r) => {
    if (r.inHouse) return (r.inHouseCost === '' || r.inHouseCost == null) ? null : Number(r.inHouseCost);
    if (!r.chosen) return null;
    const b = r.bids.find((x) => x.vendor_id === r.chosen);
    return (b && b.can_supply !== false && b.unit_cost != null) ? Number(b.unit_cost) : null;
  };
  const clientUnitOf = (r) => { const c = chosenCostOf(r); return c == null ? null : Math.round(c * (1 + (Number(r.markup) || 0) / 100)); };

  const totals = (() => {
    let cost = 0, client = 0;
    rows.forEach((r) => { const c = chosenCostOf(r), u = clientUnitOf(r); if (c != null) cost += c * r.quantity; if (u != null) client += u * r.quantity; });
    return { cost, client, margin: client - cost };
  })();
  const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');

  const pricedRows = () => rows.map((r) => ({ sub_event_name: r.sub_event_name, description: r.description, quantity: r.quantity, clientUnitPrice: clientUnitOf(r) }));
  const summaryLines = () => rows.map((r) => ({
    item: r.description, sub_event: r.sub_event_name, qty: r.quantity,
    bids: r.bids.map((b) => ({ vendor_id: b.vendor_id, unit_cost: b.unit_cost, can_supply: b.can_supply, note: b.item_note })),
    in_house: r.inHouse, in_house_cost: r.inHouse ? (r.inHouseCost === '' ? null : Number(r.inHouseCost)) : null,
    chosen: r.inHouse ? 'in-house' : r.chosen, chosen_cost: chosenCostOf(r), markup_pct: Number(r.markup) || 0, client_unit_price: clientUnitOf(r),
  }));

  const validate = () => {
    const hard = [];
    rows.forEach((r) => { if (clientUnitOf(r) == null) hard.push(r.description + (r.inHouse ? ' — enter an in-house cost' : ' — no usable vendor cost; price in-house or source another vendor')); });
    if (!rows.length) hard.push('There are no items to price.');
    if (!d.draftQuoteId) hard.push('No draft quote is linked to this RFQ.');
    const soft = [];
    rows.forEach((r) => { const c = chosenCostOf(r), u = clientUnitOf(r); if (c != null && u != null && u <= c) soft.push('No margin on “' + r.description + '” (price ≤ cost).'); if (c === 0) soft.push('“' + r.description + '” has a zero cost.'); if ((Number(r.markup) || 0) > 200) soft.push('“' + r.description + '” markup is ' + r.markup + '% — is that intended?'); });
    const totalMarginPct = totals.client > 0 ? (totals.margin / totals.client) * 100 : 0;
    if (totals.client > 0 && totalMarginPct < MARGIN_FLOOR_PCT) soft.push('Total margin is ' + Math.round(totalMarginPct) + '% — below the ' + MARGIN_FLOOR_PCT + '% floor.');
    const pending = (d.vrfqs || []).filter((v) => v.status !== 'submitted').length;
    if (pending) soft.push(pending + ' vendor RFQ' + (pending > 1 ? 's' : '') + ' still pending — you may be leaving a cheaper bid on the table.');
    const overrides = rows.filter((r) => !r.inHouse && r.autoCheapest && r.chosen !== r.autoCheapest).length;
    if (overrides && !internalNotes.trim()) soft.push('You picked a costlier source than the cheapest on ' + overrides + ' item' + (overrides > 1 ? 's' : '') + ' — consider noting why in internal notes.');
    return { hard, soft };
  };

  const doGenerate = async () => {
    setBusy(true);
    try {
      await generateQuoteFromCosting(d.draftQuoteId, pricedRows());
      await saveCostingSummary({ client_rfq_id: rfqId, quotation_id: d.draftQuoteId, default_markup_pct: d.defaultMarkup, total_cost: totals.cost, total_client: totals.client, total_margin: totals.margin, internal_notes: internalNotes, lines: summaryLines() });
      notify('Quote priced + costing summary saved.', 'success');
      onNavigate && onNavigate('quotations', { quotId: d.draftQuoteId, label: 'Quote' });
    } catch (e) { notify((e && e.message) || 'Could not generate the quote.', 'error'); }
    setBusy(false);
  };
  const onGenerate = () => {
    const { hard, soft } = validate();
    if (hard.length) { setWarn({ hard, soft: [], proceed: null }); return; }
    if (soft.length) { setWarn({ hard: [], soft, proceed: doGenerate }); return; }
    doGenerate();
  };
  const onSaveSummary = async () => {
    setBusy(true);
    try { await saveCostingSummary({ client_rfq_id: rfqId, quotation_id: d.draftQuoteId, default_markup_pct: d.defaultMarkup, total_cost: totals.cost, total_client: totals.client, total_margin: totals.margin, internal_notes: internalNotes, lines: summaryLines() }); notify('Costing summary saved.', 'success'); }
    catch (e) { notify('Could not save the summary.', 'error'); }
    setBusy(false);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  if (!d || !d.rfq) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--grey-400)' }}>Could not load costing. <button className="btn sm" onClick={onBack}>← Back</button></div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>Costing &amp; markup</div>
          <div style={{ fontSize: 13, color: 'var(--grey-400)', marginTop: 2 }}>{d.rfq.ref_number}{d.rfq.event_type ? (' · ' + d.rfq.event_type) : ''} · {d.columns.length} vendor bid{d.columns.length === 1 ? '' : 's'} · default markup {d.defaultMarkup}%</div>
        </div>
        <button className="btn sm" onClick={onBack}>← Back</button>
      </div>

      {d.columns.length === 0 && <div style={{ background: 'var(--orange-light)', color: '#854F0B', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>No vendor has submitted a bid yet — you can still price items in-house below.</div>}

      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflowX: 'auto', marginBottom: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}>
          <thead>
            <tr style={{ color: 'var(--grey-400)', textAlign: 'right' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 500 }}>Item</th>
              {d.columns.map((c) => <th key={c.vendor_id} style={{ padding: '10px 8px', fontWeight: 500 }}>{c.name}</th>)}
              <th style={{ padding: '10px 8px', fontWeight: 500 }}>In-house</th>
              <th style={{ padding: '10px 8px', fontWeight: 500 }}>Markup</th>
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Client price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const cu = clientUnitOf(r);
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--grey-100)', textAlign: 'right' }}>
                  <td style={{ textAlign: 'left', padding: '9px 12px' }}>{r.description}<span style={{ color: 'var(--grey-400)' }}> · ×{r.quantity}</span>{r.sub_event_name ? <div style={{ fontSize: 11, color: 'var(--grey-400)' }}>{r.sub_event_name}</div> : null}</td>
                  {d.columns.map((c) => {
                    const b = r.bids.find((x) => x.vendor_id === c.vendor_id);
                    if (!b) return <td key={c.vendor_id} style={{ padding: '9px 8px', color: 'var(--grey-300)' }}>—</td>;
                    if (b.can_supply === false) return <td key={c.vendor_id} style={{ padding: '9px 8px', color: 'var(--red)' }} title="Can't supply">✕</td>;
                    const isChosen = !r.inHouse && r.chosen === c.vendor_id;
                    return (
                      <td key={c.vendor_id} onClick={() => setRow(i, { inHouse: false, chosen: c.vendor_id })} title={(b.item_note ? ('Note: ' + b.item_note + '  ') : '') + (isChosen ? 'chosen' : 'click to choose')} style={{ padding: '9px 8px', cursor: 'pointer', background: isChosen ? 'var(--green-light)' : 'transparent', color: isChosen ? 'var(--green)' : 'var(--grey-800)', fontWeight: isChosen ? 600 : 400 }}>
                        {b.unit_cost != null ? Number(b.unit_cost).toLocaleString('en-IN') : '—'}{b.item_note ? ' 📝' : ''}
                      </td>
                    );
                  })}
                  <td style={{ padding: '9px 8px', background: r.inHouse ? 'var(--green-light)' : 'transparent', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={r.inHouse} onChange={(e) => setRow(i, { inHouse: e.target.checked, chosen: e.target.checked ? null : r.autoCheapest })} title="Manage in-house" style={{ verticalAlign: 'middle' }} />
                    {r.inHouse && <input value={r.inHouseCost} onChange={(e) => setRow(i, { inHouseCost: e.target.value })} placeholder="cost" inputMode="numeric" style={{ width: 64, marginLeft: 4, fontSize: 12, padding: '3px 6px' }} />}
                  </td>
                  <td style={{ padding: '9px 8px', whiteSpace: 'nowrap' }}><input value={r.markup} onChange={(e) => setRow(i, { markup: e.target.value, markupOverridden: true })} inputMode="numeric" style={{ width: 46, fontSize: 12, padding: '3px 6px', textAlign: 'right' }} />%</td>
                  <td style={{ padding: '9px 12px', fontWeight: 600 }}>{cu != null ? inr(cu * r.quantity) : <span style={{ color: 'var(--red)' }}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 14 }}>
        {[['Total cost', totals.cost, 'var(--grey-800)'], ['Client total', totals.client, 'var(--blue)'], ['Margin', totals.margin, 'var(--green)']].map(([l, v, col]) => (
          <div key={l} style={{ background: 'var(--grey-50)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
            <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: col }}>{inr(v)}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', padding: '14px 18px', marginBottom: 14 }}>
        <label className="field-label">Internal notes (saved to the costing summary)</label>
        <textarea className="field-textarea" rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder="e.g. went with Petal on lighting — Blooms booked that week" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button className="btn" disabled={busy} onClick={onSaveSummary}>Save costing summary</button>
        <button className="btn primary" disabled={busy} onClick={onGenerate}>{busy ? 'Working…' : 'Generate quote →'}</button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--grey-400)' }}>Tip: click a vendor's cost to choose it · the cheapest is picked automatically · 📝 = vendor note</div>

      {warn && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setWarn(null)}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', maxWidth: 460, padding: '20px 22px' }} onClick={(e) => e.stopPropagation()}>
            {warn.hard.length > 0 ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>Fix these before generating</div>
                <ul style={{ fontSize: 13, color: 'var(--grey-700)', lineHeight: 1.6, paddingLeft: 18, margin: '0 0 14px' }}>{warn.hard.map((h, i) => <li key={i}>{h}</li>)}</ul>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn primary" onClick={() => setWarn(null)}>OK</button></div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#854F0B', marginBottom: 8 }}>A few things to check</div>
                <ul style={{ fontSize: 13, color: 'var(--grey-700)', lineHeight: 1.6, paddingLeft: 18, margin: '0 0 14px' }}>{warn.soft.map((s, i) => <li key={i}>{s}</li>)}</ul>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button className="btn" onClick={() => setWarn(null)}>Back</button><button className="btn primary" disabled={busy} onClick={() => { const p = warn.proceed; setWarn(null); if (p) p(); }}>Generate anyway</button></div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
