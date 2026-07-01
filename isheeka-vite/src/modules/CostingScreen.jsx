// Milestone S · S3 — Costing & markup screen. Compares submitted vendor bids per item,
// auto-picks the cheapest, applies markup (default + per-item override), and produces a
// priced draft quote + a saved costing summary. See docs/milestone-s-vendor-rfq-spec.md.
import React from 'react';
import { notify } from '../lib/toast.jsx';
import { fmtDate } from '../lib/format.js';
import { buildCostingPdf, buildCostingXlsx } from '../lib/costingSheet.js';
import { uploadToQuotations, signedUrl } from '../lib/storage.js';
import { openWhatsApp } from '../lib/share.js';
import { loadCostingData, generateQuoteFromCosting, saveCostingSummary, costKey } from '../lib/costing.js';

const MARGIN_FLOOR_PCT = 15; // soft-warning threshold (spec §5 #5)

export function CostingScreen({ rfqId, onBack, onNavigate }) {
  const [d, setD] = React.useState(null);
  const [rows, setRows] = React.useState([]);
  const [internalNotes, setInternalNotes] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [warn, setWarn] = React.useState(null);
  const [gmk, setGmk] = React.useState('30');
  const [expanded, setExpanded] = React.useState({});
  const [allExpanded, setAllExpanded] = React.useState(false);

  React.useEffect(() => { (async () => {
    setLoading(true);
    const data = await loadCostingData(rfqId);
    setD(data);
    const rs = (data.clientItems || []).map((it) => {
      const bids = data.bidsByKey[costKey(it)] || [];
      let chosen = null, best = Infinity;
      bids.forEach((b) => { if (b.can_supply !== false && b.unit_cost != null && Number(b.unit_cost) < best) { best = Number(b.unit_cost); chosen = b.vendor_id; } });
      return { key: costKey(it), clientItemId: it.rfq_item_id, sub_event_name: it.sub_event_name || '', description: it.description, quantity: Number(it.quantity) || 1, sub_items: Array.isArray(it.sub_items) ? it.sub_items : [], bids, inHouse: false, inHouseCost: '', chosen, markup: data.defaultMarkup, markupOverridden: false, autoCheapest: chosen };
    });
    setRows(rs);
    setGmk(String(data.defaultMarkup ?? 30));
    setLoading(false);
  })(); }, [rfqId]);

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Global markup: typing/dragging re-prices every non-customised row live; "Apply to
  // all" (force) resets per-item overrides too. Keeps d.defaultMarkup in sync for saves.
  const applyGlobalMarkup = (raw, force) => {
    const clean = (raw === '' ? '' : String(Math.max(0, parseFloat(raw) || 0)));
    setGmk(clean);
    const val = clean === '' ? '0' : clean;
    setRows((rs) => rs.map((r) => (force ? { ...r, markup: val, markupOverridden: false } : (!r.markupOverridden ? { ...r, markup: val } : r))));
    setD((dd) => (dd ? { ...dd, defaultMarkup: Number(val) || 0 } : dd));
  };

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
    item: r.description, sub_event: r.sub_event_name, qty: r.quantity, sub_items: Array.isArray(r.sub_items) ? r.sub_items : [],
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

  // Internal costing sheet (PDF / Excel / WhatsApp) — vendor costs + margins, never shared with clients.
  // For PDF/Excel only include submitted vendors so the sheet stays clean.
  const submittedColumns = (d.columns || []).filter((c) => c.status === 'submitted');
  const sheetPayload = () => ({
    rfq: d.rfq, columns: submittedColumns, schedule: (d.rfq && d.rfq.sub_events) || [], totals,
    rows: rows.map((r) => {
      const cost = chosenCostOf(r), client = clientUnitOf(r);
      return {
        sub_event_name: r.sub_event_name, description: r.description, quantity: r.quantity,
        bids: submittedColumns.map((c) => { const b = r.bids.find((x) => x.vendor_id === c.vendor_id); return (b && b.can_supply !== false && b.unit_cost != null) ? Number(b.unit_cost) : null; }),
        inhouse: r.inHouse ? (r.inHouseCost === '' ? null : Number(r.inHouseCost)) : null,
        chosen: cost, markupPct: Number(r.markup) || 0,
        markupRs: (cost != null && client != null) ? (client - cost) * r.quantity : null,
        clientUnit: client, lineTotal: (client != null) ? client * r.quantity : null,
      };
    }),
  });
  const dlPdf = () => { try { buildCostingPdf(sheetPayload(), { action: 'download' }); } catch (e) { notify('Could not generate the PDF.', 'error'); } };
  const dlXlsx = async () => { try { await buildCostingXlsx(sheetPayload()); } catch (e) { notify('Could not generate the Excel.', 'error'); } };
  const shareWa = async () => {
    try {
      notify('Preparing the costing sheet…', 'info', 2000);
      const blob = buildCostingPdf(sheetPayload(), { output: 'blob' });
      const file = new File([blob], 'costing.pdf', { type: 'application/pdf' });
      const path = await uploadToQuotations(file, 'costing');
      const url = path ? await signedUrl(path, 60 * 60 * 24 * 30) : null;
      const nm = [d.rfq.contact_first_name, d.rfq.contact_last_name].filter(Boolean).join(' ').trim() || d.rfq.contact_name || '';
      const msg = 'Internal costing — ' + (d.rfq.ref_number || '') + (nm ? (' · ' + nm) : '') + '\nClient total ' + inr(totals.client) + ' · Margin ' + inr(totals.margin) + (url ? ('\n\n' + url) : '') + '\n\n(Internal — not for the client)';
      openWhatsApp('', msg);
    } catch (e) { notify('Could not prepare the share.', 'error'); }
  };

  const readOnly = !!(d && d.eventClosed);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>Costing &amp; markup</div>
          <div style={{ fontSize: 13, color: 'var(--grey-400)', marginTop: 2 }}>{d.rfq.ref_number}{d.rfq.event_type ? (' · ' + d.rfq.event_type) : ''} · {d.columns.filter((c) => c.status === 'submitted').length}/{d.columns.length} vendor{d.columns.length === 1 ? '' : 's'} submitted · default markup {d.defaultMarkup}%</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10.5, color: 'var(--grey-400)', marginRight: 2 }} title="Internal use only — contains vendor costs & margins">🔒 Internal:</span>
          <button className="btn sm" onClick={dlPdf} title="Download internal costing PDF">⬇ PDF</button>
          <button className="btn sm" onClick={dlXlsx} title="Download internal costing Excel">⬇ Excel</button>
          <button className="btn sm" onClick={shareWa} title="Share the internal costing PDF via WhatsApp">💬 WhatsApp</button>
          <button className="btn sm" onClick={onBack}>← Back</button>
        </div>
      </div>

      {readOnly && <div style={{ background: 'var(--grey-50)', border: '1px solid var(--grey-100)', color: 'var(--grey-600)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>🔒 The event for this RFQ is completed or cancelled — this costing is <b>view-only</b>. You can review the chosen bids and margins, but can't re-price or regenerate the quote.</div>}
      {!readOnly && d.columns.filter((c) => c.status === 'submitted').length === 0 && <div style={{ background: 'var(--orange-light)', color: '#854F0B', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{d.columns.length === 0 ? 'No vendors have been sent this RFQ yet.' : 'No vendor has submitted a bid yet — you can still price items in-house below.'}</div>}

      {!readOnly && (
        <div style={{ background: 'var(--grey-50)', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-800)' }}>Global markup</span>
            <input value={gmk} onChange={(e) => applyGlobalMarkup(e.target.value, false)} inputMode="numeric" style={{ width: 56, fontSize: 14, fontWeight: 600, padding: '4px 8px', textAlign: 'right' }} />
            <span style={{ fontSize: 13, color: 'var(--grey-500)' }}>%</span>
            <input type="range" min="0" max="80" step="1" value={Math.min(80, parseFloat(gmk) || 0)} onChange={(e) => applyGlobalMarkup(e.target.value, false)} style={{ flex: 1, minWidth: 130 }} />
            {[20, 25, 30, 35, 40].map((p) => <button key={p} className="btn sm" onClick={() => applyGlobalMarkup(String(p), false)} style={(parseFloat(gmk) === p) ? { borderColor: 'var(--pink)', color: 'var(--pink)' } : {}}>{p}%</button>)}
            <button className="btn sm primary" onClick={() => applyGlobalMarkup(gmk || '0', true)} title="Set every item (including customised) to this %">Apply to all</button>
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
            <span style={{ color: 'var(--grey-500)' }}>Total cost <b style={{ color: 'var(--grey-800)' }}>{inr(totals.cost)}</b></span>
            <span style={{ color: 'var(--grey-500)' }}>Client total <b style={{ color: 'var(--pink)' }}>{inr(totals.client)}</b></span>
            <span style={{ color: 'var(--grey-500)' }}>Margin <b style={{ color: 'var(--green)' }}>{inr(totals.margin)}{totals.cost > 0 ? ' · ' + Math.round(totals.margin / totals.cost * 100) + '%' : ''}</b></span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 6 }}>Updates every item except ones you've customised (✎). “Apply to all” overrides those too.</div>
        </div>
      )}

      {rows.some((r) => Array.isArray(r.sub_items) && r.sub_items.length > 0) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <button className="btn sm" onClick={() => { setAllExpanded((v) => !v); setExpanded({}); }}>{allExpanded ? 'Collapse all details' : 'Expand all details'}</button>
        </div>
      )}
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflowX: 'auto', marginBottom: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}>
          <thead>
            <tr style={{ color: 'var(--grey-400)', textAlign: 'right' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 500 }}>Item</th>
              {d.columns.map((c) => (
                <th key={c.vendor_id} style={{ padding: '10px 8px', fontWeight: 500 }}>
                  {c.name}
                  {c.status !== 'submitted' && <span style={{ display: 'block', fontSize: 9.5, fontWeight: 400, color: '#C07000', letterSpacing: 0.2 }}>{c.status === 'sent' ? 'pending' : c.status}</span>}
                </th>
              ))}
              <th style={{ padding: '10px 8px', fontWeight: 500 }}>In-house</th>
              <th style={{ padding: '10px 8px', fontWeight: 500 }}>Markup</th>
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Client price</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const colCount = d.columns.length + 4;
              const sched = {}; ((d.rfq && d.rfq.sub_events) || []).forEach((s) => { sched[String(s.name || '').toLowerCase().trim()] = s; });
              const order = []; const grp = {};
              rows.forEach((r, i) => { const k = r.sub_event_name || 'General'; if (!grp[k]) { grp[k] = []; order.push(k); } grp[k].push({ r, i }); });
              const out = [];
              order.forEach((k) => {
                const s = sched[k.toLowerCase().trim()] || {};
                out.push(<tr key={'h-' + k}><td colSpan={colCount} style={{ background: 'var(--pink-light)', color: 'var(--pink)', fontWeight: 700, fontSize: 11, padding: '7px 12px', textAlign: 'left' }}>{k}{s.planned_date ? (' · ' + fmtDate(s.planned_date, { day: 'numeric', month: 'short', year: 'numeric' })) : ''}{s.venue ? (' · 📍 ' + s.venue) : ''}</td></tr>);
                let gcost = 0, gclient = 0;
                grp[k].forEach(({ r, i }) => {
                  const cu = clientUnitOf(r); const cc = chosenCostOf(r);
                  if (cc != null) gcost += cc * r.quantity; if (cu != null) gclient += cu * r.quantity;
                  out.push(
                    <tr key={i} style={{ borderTop: '1px solid var(--grey-100)', textAlign: 'right' }}>
                      <td style={{ textAlign: 'left', padding: '9px 12px' }}>
                        {r.description}<span style={{ color: 'var(--grey-400)' }}> · ×{r.quantity}</span>
                        {Array.isArray(r.sub_items) && r.sub_items.length > 0 && (() => {
                          const rk = r.clientItemId || ('row' + i);
                          const open = (rk in expanded) ? expanded[rk] : allExpanded;
                          const summary = r.sub_items.map((si) => si.name).filter(Boolean).join(', ');
                          return (
                            <div style={{ marginTop: 2 }}>
                              <button onClick={(e) => { e.stopPropagation(); setExpanded((pp) => ({ ...pp, [rk]: !open })); }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--grey-500)' }} title={open ? 'Hide details' : 'Show details'}>
                                {open ? '▾' : '▸'} {r.sub_items.length} detail{r.sub_items.length > 1 ? 's' : ''}
                              </button>
                              {!open && summary && <span style={{ fontSize: 11, color: 'var(--grey-300)', marginLeft: 6 }}>incl. {summary.length > 48 ? summary.slice(0, 48) + '…' : summary}</span>}
                              {open && (
                                <div style={{ paddingLeft: 12, marginTop: 2 }}>
                                  {r.sub_items.map((si, si_i) => (
                                    <div key={si_i} style={{ fontSize: 11, color: 'var(--grey-400)', lineHeight: 1.5 }}>
                                      • {si.name}{si.qty > 0 ? ' × ' + si.qty : ''}{si.note ? <span> ({si.note})</span> : null}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      {d.columns.map((c) => {
                        // Look up whether this vendor was sent the client item via source_item_id.
                        const vendorItem = (d.vendorItemBySource || {})[c.rfq_id]?.[r.clientItemId];
                        // Fall back to bid-key match for submitted vendors (handles items sent
                        // before source_item_id was recorded).
                        const bidFallback = r.bids.find((x) => x.vendor_id === c.vendor_id);

                        if (!vendorItem && !bidFallback) {
                          // Vendor was not sent this item at all.
                          return <td key={c.vendor_id} style={{ padding: '9px 8px', color: 'var(--grey-400)', fontStyle: 'italic', fontSize: 11.5 }}>Not requested</td>;
                        }

                        // Use vendorItem if available, otherwise synthesise from bidFallback.
                        const vi = vendorItem || { unit_cost: bidFallback.unit_cost, can_supply: bidFallback.can_supply, item_note: bidFallback.item_note };

                        if (vi.can_supply === false) {
                          return <td key={c.vendor_id} style={{ padding: '9px 8px', color: 'var(--red)', fontStyle: 'italic', fontSize: 11.5 }} title="Vendor cannot supply this item">Cannot supply</td>;
                        }

                        if (vi.unit_cost == null) {
                          // Sent but not yet priced.
                          return <td key={c.vendor_id} style={{ padding: '9px 8px', color: '#C07000', fontStyle: 'italic', fontSize: 11.5 }} title="Vendor has not priced this item yet">Awaiting…</td>;
                        }

                        // Vendor has submitted a price.
                        const isChosen = !r.inHouse && r.chosen === c.vendor_id;
                        return (
                          <td key={c.vendor_id} onClick={() => { if (!readOnly) setRow(i, { inHouse: false, chosen: c.vendor_id }); }} title={(vi.item_note ? ('Note: ' + vi.item_note + '  ') : '') + (readOnly ? (isChosen ? 'chosen' : '') : (isChosen ? 'chosen' : 'click to choose'))} style={{ padding: '9px 8px', cursor: readOnly ? 'default' : 'pointer', background: isChosen ? 'var(--green-light)' : 'transparent', color: isChosen ? 'var(--green)' : 'var(--grey-800)', fontWeight: isChosen ? 600 : 400 }}>
                            {Number(vi.unit_cost).toLocaleString('en-IN')}{vi.item_note ? ' 📝' : ''}
                          </td>
                        );
                      })}
                      <td style={{ padding: '9px 8px', background: r.inHouse ? 'var(--green-light)' : 'transparent', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={r.inHouse} disabled={readOnly} onChange={(e) => setRow(i, { inHouse: e.target.checked, chosen: e.target.checked ? null : r.autoCheapest })} title="Manage in-house" style={{ verticalAlign: 'middle' }} />
                        {r.inHouse && <input value={r.inHouseCost} disabled={readOnly} onChange={(e) => setRow(i, { inHouseCost: e.target.value })} placeholder="cost" inputMode="numeric" style={{ width: 64, marginLeft: 4, fontSize: 12, padding: '3px 6px' }} />}
                      </td>
                      <td style={{ padding: '9px 8px', whiteSpace: 'nowrap' }}>{r.markupOverridden && <span title="Customised — not changed by the global markup" style={{ color: '#B8893A', marginRight: 2 }}>✎</span>}<input value={r.markup} disabled={readOnly} onChange={(e) => setRow(i, { markup: e.target.value, markupOverridden: true })} inputMode="numeric" style={{ width: 46, fontSize: 12, padding: '3px 6px', textAlign: 'right' }} />%</td>
                      <td style={{ padding: '9px 12px', fontWeight: 600 }}>{cu != null ? inr(cu * r.quantity) : <span style={{ color: 'var(--red)' }}>—</span>}</td>
                    </tr>
                  );
                });
                out.push(<tr key={'s-' + k}><td colSpan={colCount} style={{ textAlign: 'right', fontSize: 11, color: 'var(--grey-500)', padding: '5px 12px', background: 'var(--grey-50)' }}>{k} subtotal — cost {inr(gcost)} · client {inr(gclient)}</td></tr>);
              });
              return out;
            })()}
          </tbody>
        </table>
      </div>

      {/* Bid-state legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--grey-500)', marginBottom: 14, padding: '6px 2px', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--grey-100)', display: 'inline-block' }} /> <i>Not requested</i></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 2, background: '#FDDFA0', display: 'inline-block' }} /> <i style={{ color: '#C07000' }}>Awaiting bid</i></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--green-light)', display: 'inline-block' }} /> Priced</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 2, background: '#FDDEDE', display: 'inline-block' }} /> <span style={{ color: 'var(--red)' }}>Cannot supply</span></span>
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
        <textarea className="field-textarea" rows={2} value={internalNotes} disabled={readOnly} onChange={(e) => setInternalNotes(e.target.value)} placeholder="e.g. went with Petal on lighting — Blooms booked that week" />
      </div>

      {!readOnly && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button className="btn" disabled={busy} onClick={onSaveSummary}>Save costing summary</button>
        <button className="btn primary" disabled={busy} onClick={onGenerate}>{busy ? 'Working…' : 'Generate quote →'}</button>
      </div>}
      {!readOnly && <div style={{ fontSize: 11.5, color: 'var(--grey-400)' }}>Tip: click a vendor's cost to choose it · the cheapest is picked automatically · 📝 = vendor note</div>}

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
