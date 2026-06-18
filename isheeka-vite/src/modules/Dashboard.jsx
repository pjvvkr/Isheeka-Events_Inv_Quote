// Dashboard — greeting, KPI cards, upcoming events + outstanding invoices (ported verbatim).
import React from 'react';
import { supabase } from '../lib/supabase';
import { fmtDate } from '../lib/format.js';

export function Dashboard({ user, onNavigate }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.user_metadata?.first_name || user?.email?.split('@')[0] || 'there';
  const [stats, setStats] = React.useState({ activeLeads: 0, upcomingCount: 0, quotedMonth: 0, collectedMonth: 0, rfqReview: 0 });
  const [upcoming, setUpcoming] = React.useState([]);
  const [outstanding, setOutstanding] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => { (async () => {
    setLoading(true);
    const now = new Date(), _p = (n) => String(n).padStart(2, '0'), todayStr = now.getFullYear() + '-' + _p(now.getMonth() + 1) + '-' + _p(now.getDate()), monthStr = now.getFullYear() + '-' + _p(now.getMonth() + 1);
    const [{ data: leads }, { data: events }, { data: quotes }, { data: pays }, { data: invs }, { count: rfqReview }] = await Promise.all([
      supabase.from('leads').select('stage').eq('is_deleted', false),
      supabase.from('events').select('event_id,name,ref_number,main_date,status,client_name').eq('is_deleted', false),
      supabase.from('quotations').select('grand_total,doc_date,status,event_id').eq('is_deleted', false),
      supabase.from('invoice_payments').select('amount,payment_date,invoice_id'),
      supabase.from('invoices').select('invoice_id,ref_number,client_name,event_name,total_outstanding,status').eq('is_deleted', false),
      supabase.from('rfqs').select('rfq_id', { count: 'exact', head: true }).eq('is_deleted', false).eq('status', 'submitted'),
    ]);
    const cancelledInv = {}; (invs || []).forEach((i) => { if (i.status === 'cancelled') cancelledInv[i.invoice_id] = true; });
    const cancelledEvt = {}; (events || []).forEach((e) => { if ((e.status || '').toLowerCase() === 'cancelled') cancelledEvt[e.event_id] = true; });
    const activeLeads = (leads || []).filter((l) => !['lost', 'event_triggered'].includes(l.stage)).length;
    const up = (events || []).filter((e) => e.main_date && e.main_date >= todayStr && !['completed', 'cancelled'].includes(e.status)).sort((a, b) => a.main_date.localeCompare(b.main_date));
    const quotedMonth = (quotes || []).filter((q) => !['superseded', 'rejected'].includes(q.status) && !(q.event_id && cancelledEvt[q.event_id]) && q.doc_date && q.doc_date.slice(0, 7) === monthStr).reduce((s, q) => s + (parseFloat(q.grand_total) || 0), 0);
    const collectedMonth = (pays || []).filter((p) => p.payment_date && p.payment_date.slice(0, 7) === monthStr && !cancelledInv[p.invoice_id]).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const out = (invs || []).filter((i) => !['paid', 'cancelled'].includes(i.status) && (parseFloat(i.total_outstanding) || 0) > 0).sort((a, b) => (parseFloat(b.total_outstanding) || 0) - (parseFloat(a.total_outstanding) || 0));
    setStats({ activeLeads, upcomingCount: up.length, quotedMonth, collectedMonth, rfqReview: rfqReview || 0 });
    setUpcoming(up.slice(0, 5)); setOutstanding(out.slice(0, 5)); setLoading(false);
  })(); }, []);
  const inr = (n) => '₹' + (parseFloat(n) || 0).toLocaleString('en-IN');
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--grey-800)' }}>{greeting}, {firstName}! 👋</h1>
        <p style={{ fontSize: 14, color: 'var(--grey-400)', marginTop: 4 }}>Here's what's happening with Isheeka Events today.</p>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {stats.rfqReview > 0 && <div onClick={() => onNavigate && onNavigate('rfqs')} style={{ cursor: 'pointer', background: 'var(--pink-light)', color: 'var(--pink)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 13, fontWeight: 500 }}>⏳ {stats.rfqReview} client RFQ{stats.rfqReview > 1 ? 's' : ''} awaiting review — Review →</div>}
        <button className="btn sm primary" onClick={() => onNavigate && onNavigate('rfqs', { mode: 'new', label: 'New RFQ' })}>📝 New Client RFQ</button>
      </div>
      <div className="metrics-grid">
        <div className="metric-card pink" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('leads')}><div className="metric-icon">🎯</div><div className="metric-value">{stats.activeLeads}</div><div className="metric-label">Active leads</div></div>
        <div className="metric-card green" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('events')}><div className="metric-icon">🎪</div><div className="metric-value">{stats.upcomingCount}</div><div className="metric-label">Upcoming events</div></div>
        <div className="metric-card orange" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('quotations')}><div className="metric-icon">📋</div><div className="metric-value">{inr(stats.quotedMonth)}</div><div className="metric-label">Quoted this month</div></div>
        <div className="metric-card blue" style={{ cursor: 'pointer' }} onClick={() => onNavigate && onNavigate('invoices')}><div className="metric-icon">💰</div><div className="metric-value">{inr(stats.collectedMonth)}</div><div className="metric-label">Collected this month</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 4 }}>
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px 20px', border: '1px solid var(--grey-100)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 10 }}>Upcoming events</div>
          {loading ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>Loading…</div> : upcoming.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>No upcoming events.</div> : upcoming.map((e) => (
            <div key={e.event_id} onClick={() => onNavigate && onNavigate('events', { eventId: e.event_id, label: e.name || e.ref_number || 'Event' })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--grey-50)', cursor: 'pointer' }}>
              <div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-800)' }}>{e.name}</div><div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{e.client_name || ''}{e.ref_number ? ' · ' + e.ref_number : ''}</div></div>
              <div style={{ fontSize: 12, color: 'var(--pink)', fontWeight: 500, whiteSpace: 'nowrap' }}>{fmtDate(e.main_date, { day: 'numeric', month: 'short' })}</div>
            </div>
          ))}
        </div>
        <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px 20px', border: '1px solid var(--grey-100)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--grey-800)', marginBottom: 10 }}>Outstanding invoices</div>
          {loading ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>Loading…</div> : outstanding.length === 0 ? <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>Nothing outstanding. 🎉</div> : outstanding.map((i) => (
            <div key={i.invoice_id} onClick={() => onNavigate && onNavigate('invoices', { invoiceId: i.invoice_id, label: i.ref_number })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--grey-50)', cursor: 'pointer' }}>
              <div><div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-800)' }}>{i.ref_number}</div><div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{i.client_name || ''}{i.event_name ? ' · ' + i.event_name : ''}</div></div>
              <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 500, whiteSpace: 'nowrap' }}>{inr(i.total_outstanding)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
