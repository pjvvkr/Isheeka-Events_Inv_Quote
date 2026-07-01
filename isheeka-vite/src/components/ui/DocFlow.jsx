// Document-flow lifecycle rail. Pure presentation over a resolved chain (see lib/docChain.js).
// Shows Lead -> Client RFQ -> [Vendor RFQ -> Costing] -> Quote -> Event -> Invoice ->
// Receivable -> Payable. Existing stages are clickable; missing ones show "Not created";
// the current screen's node is highlighted. Read-only — no writes, no business logic.
import React from 'react';

const inr = (n) => '₹' + Math.round(parseFloat(n) || 0).toLocaleString('en-IN');

function circleStyle(state, small) {
  const sz = small ? 27 : 32;
  const base = { width: sz, height: sz, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: small ? 14 : 16, flexShrink: 0 };
  if (state === 'current') return { ...base, background: 'var(--pink)', color: '#fff', boxShadow: '0 0 0 3px var(--pink-light)' };
  if (state === 'done') return { ...base, background: 'var(--pink-light)', color: 'var(--pink)' };
  if (state === 'progress') return { ...base, background: 'var(--orange-light)', color: 'var(--orange)' };
  if (state === 'settled') return { ...base, background: 'var(--green-light)', color: 'var(--green)' };
  return { ...base, background: 'transparent', color: 'var(--grey-300)', border: '1.5px dashed var(--grey-300)' };
}
function subColor(state) {
  if (state === 'current') return 'var(--grey-400)';
  if (state === 'progress') return 'var(--orange)';
  if (state === 'settled') return 'var(--green)';
  if (state === 'done') return 'var(--pink)';
  return 'var(--grey-300)';
}

function Node({ icon, label, sub, state, small, onClick, hint }) {
  const clickable = onClick && ['done', 'progress', 'settled', 'current'].includes(state);
  return (
    <div onClick={clickable ? onClick : undefined} title={hint || (clickable ? ('Open ' + (sub || label)) : undefined)}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: small ? 4 : 5, width: small ? 74 : 80, flexShrink: 0, textAlign: 'center', cursor: clickable ? 'pointer' : 'default' }}>
      <div style={circleStyle(state, small)}>{icon}</div>
      <div style={{ fontSize: 11, fontWeight: 500, color: (state === 'none') ? 'var(--grey-400)' : 'var(--grey-800)' }}>{label}</div>
      <div style={{ fontSize: 11, color: subColor(state), textDecoration: (clickable && (sub || '').match(/^[A-Z]+-/)) ? 'underline' : 'none', whiteSpace: 'nowrap' }}>{sub}</div>
    </div>
  );
}

const Conn = ({ dashed }) => (
  <div style={{ flex: 1, minWidth: 10, marginTop: 15, height: dashed ? 0 : 2, background: dashed ? 'none' : 'var(--grey-200)', borderTop: dashed ? '2px dashed var(--grey-200)' : 'none' }} />
);

export function DocFlow({ chain, current, onNavigate }) {
  if (!chain) return null;
  const c = chain;
  const nav = (page, opts) => { if (onNavigate) onNavigate(page, opts); };
  const isCur = (k) => current === k;

  const lead = c.lead ? { state: isCur('lead') ? 'current' : 'done', sub: c.lead.ref_number || 'Lead', onClick: () => nav('leads', { leadId: c.lead.lead_id, label: c.lead.ref_number }) }
    : { state: 'none', sub: 'Not created' };
  const rfq = c.clientRfq ? { state: isCur('rfq') ? 'current' : 'done', sub: c.clientRfq.ref_number || 'RFQ', onClick: () => nav('rfqs', { rfqId: c.clientRfq.rfq_id, label: c.clientRfq.ref_number }) }
    : { state: 'none', sub: 'Not created' };

  const vt = c.sourcing.vendorTotal, vs = c.sourcing.vendorSubmitted;
  const vendor = vt === 0 ? { state: 'none', sub: 'In-house' }
    : { state: vs > 0 ? 'done' : 'progress', sub: vs > 0 ? (vs + ' bid' + (vs > 1 ? 's' : '')) : (vt + ' sent'), onClick: () => c.clientRfq && nav('rfqs', { rfqId: c.clientRfq.rfq_id, label: c.clientRfq.ref_number }) };
  const openCosting = () => c.clientRfq && nav('rfqs', { costingRfqId: c.clientRfq.rfq_id, label: 'Costing' });
  const pricedTs = c.sourcing.pricedAt ? (() => { try { return new Date(c.sourcing.pricedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } })() : '';
  const costing = c.sourcing.costingExists
    ? (c.sourcing.stale
        ? { state: 'progress', sub: 'Re-source', onClick: openCosting, hint: 'Sourcing out of date — re-source needed' + (pricedTs ? (' · last priced ' + pricedTs) : '') }
        : { state: 'done', sub: 'Priced', onClick: openCosting, hint: 'Sourcing matches the quote' + (pricedTs ? (' · last priced ' + pricedTs) : '') })
    : (vs > 0 ? { state: 'progress', sub: 'Pending' } : (vt === 0 ? { state: 'none', sub: 'In-house' } : { state: 'none', sub: '—' }));

  const quote = c.quote ? { state: isCur('quote') ? 'current' : 'done', sub: c.quote.ref_number || 'Quote', onClick: () => nav('quotations', { quotId: c.quote.quotation_id, label: c.quote.ref_number }) }
    : { state: 'none', sub: 'Not created' };
  const event = c.event ? { state: isCur('event') ? 'current' : 'done', sub: c.event.ref_number || 'Event', onClick: () => nav('events', { eventId: c.event.event_id, label: c.event.name || c.event.ref_number }) }
    : { state: 'none', sub: 'Not created' };
  const invoice = c.invoice ? { state: isCur('invoice') ? 'current' : 'done', sub: c.invoice.ref_number || 'Invoice', onClick: () => nav('invoices', { invoiceId: c.invoice.invoice_id, label: c.invoice.ref_number }) }
    : { state: 'none', sub: 'Not created' };

  const ar = !c.ar ? { state: 'none', sub: 'Not raised' }
    : (c.ar.outstanding <= 0.5 && c.ar.grand > 0 ? { state: 'settled', sub: 'Settled', onClick: () => c.invoice && nav('invoices', { invoiceId: c.invoice.invoice_id }) }
      : { state: 'progress', sub: inr(c.ar.outstanding) + ' due', onClick: () => c.invoice && nav('invoices', { invoiceId: c.invoice.invoice_id }) });
  const ap = !c.ap || c.ap.count === 0 ? { state: 'none', sub: 'No vendors' }
    : (c.ap.outstanding <= 0.5 ? { state: 'settled', sub: 'Settled', onClick: () => c.event && nav('events', { eventId: c.event.event_id }) }
      : { state: 'progress', sub: inr(c.ap.outstanding) + ' due', onClick: () => c.event && nav('events', { eventId: c.event.event_id }) });

  const dash = (n) => n.state === 'none';

  return (
    <div style={{ background: 'white', border: '1px solid var(--grey-100)', borderRadius: 'var(--radius-lg)', padding: '14px 14px 10px', marginBottom: 16, overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 860 }}>
        <Node icon="🎯" label="Lead" {...lead} />
        <Conn dashed={dash(rfq)} />
        <Node icon="📝" label="Client RFQ" {...rfq} />
        <Conn dashed={dash(quote)} />
        <div style={{ flexShrink: 0, background: '#F6F1EA', border: '1px solid #ECE3D5', borderRadius: 10, padding: '4px 10px 8px', marginTop: -2 }}>
          <div style={{ fontSize: 11, color: 'var(--gold)', textAlign: 'center', marginBottom: 2 }}>sourcing</div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <Node icon="📨" label="Vendor RFQ" small {...vendor} />
            <Conn dashed={dash(costing)} />
            <Node icon="🧮" label="Costing" small {...costing} />
          </div>
        </div>
        <Conn dashed={dash(quote)} />
        <Node icon="📋" label="Quote" {...quote} />
        <Conn dashed={dash(event)} />
        <Node icon="🎪" label="Event" {...event} />
        <Conn dashed={dash(invoice)} />
        <Node icon="🧾" label="Invoice" {...invoice} />
        <Conn dashed={dash(ar)} />
        <Node icon="💰" label="Receivable" {...ar} />
        <Conn dashed={dash(ap)} />
        <Node icon="💳" label="Payable" {...ap} />
      </div>
    </div>
  );
}

export default DocFlow;
