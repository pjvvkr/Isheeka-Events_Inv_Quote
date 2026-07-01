// Reusable "Send Message" popup — WhatsApp + email to a client / lead / rfq / vendor contact,
// with the Settings-driven Isheeka branded footer appended to every message. Resolves the
// contact from a client/vendor id when only the id is known; otherwise uses phone/email passed in.
import React from 'react';
import { supabase } from '../lib/supabase';
import { CLIENT_TEMPLATES, VENDOR_TEMPLATES, brandFooter, sendWhatsApp, logEmail } from '../lib/messaging.js';

function compose(tpl, contact, footer) {
  const base = ((tpl && tpl.body && tpl.body(contact)) || '').trim();
  return (base ? base + '\n\n' : '') + (footer || '');
}

export function SendMessageModal({ party, onClose, onSent }) {
  const partyType = (party && party.type) || 'client';
  const partyId = party && party.id;
  const isVendor = partyType === 'vendor';
  const TEMPLATES = isVendor ? VENDOR_TEMPLATES : CLIENT_TEMPLATES;
  const initName = (party && (party.name || [party.first_name, party.last_name].filter(Boolean).join(' '))) || '';

  const [contact, setContact] = React.useState({ name: initName, first_name: (party && party.first_name) || initName, last_name: (party && party.last_name) || '', phone: (party && party.phone) || '', email: (party && party.email) || '' });
  const [footer, setFooter] = React.useState('');
  const [template, setTemplate] = React.useState(TEMPLATES[0].id);
  const [body, setBody] = React.useState('');
  const [phone, setPhone] = React.useState((party && party.phone) || '');
  const [email, setEmail] = React.useState((party && party.email) || '');
  const [sent, setSent] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    (async () => {
      let c = { name: initName, first_name: (party && party.first_name) || initName, last_name: (party && party.last_name) || '', phone: (party && party.phone) || '', email: (party && party.email) || '' };
      if (isVendor && partyId && (!c.phone || !c.email || !c.name)) {
        try { const { data } = await supabase.from('vendors').select('name,phone_1,email_1').eq('vendor_id', partyId).maybeSingle(); if (data) c = { name: data.name || c.name, first_name: data.name || c.first_name, last_name: '', phone: c.phone || data.phone_1 || '', email: c.email || data.email_1 || '' }; } catch (e) { /* noop */ }
      } else if (partyType === 'client' && partyId && (!c.phone || !c.email || !c.first_name)) {
        try { const { data } = await supabase.from('clients').select('first_name,last_name,phone_1,email_1').eq('client_id', partyId).maybeSingle(); if (data) { const nm = ((data.first_name || '') + ' ' + (data.last_name || '')).trim(); c = { name: nm || c.name, first_name: c.first_name || data.first_name || '', last_name: c.last_name || data.last_name || '', phone: c.phone || data.phone_1 || '', email: c.email || data.email_1 || '' }; } } catch (e) { /* noop */ }
      }
      let f = brandFooter(null);
      try { const { data: s } = await supabase.from('settings').select('company_name,phone_1,email,website').maybeSingle(); if (s) f = brandFooter(s); } catch (e) { /* noop */ }
      if (!live) return;
      setContact(c); setPhone(c.phone || ''); setEmail(c.email || ''); setFooter(f);
      setBody(compose(TEMPLATES[0], c, f));
    })();
    return () => { live = false; };
  }, [partyId, partyType]);

  const onTemplate = (id) => { setTemplate(id); const tpl = TEMPLATES.find((t) => t.id === id) || TEMPLATES[0]; setBody(compose(tpl, contact, footer)); };
  const doWA = () => { if (!phone || !body) return; sendWhatsApp({ phone, body, party_type: partyType, party_id: partyId, template }); setSent(true); if (onSent) setTimeout(onSent, 1200); };
  const doEmail = () => { if (!email || !body) return; const label = (TEMPLATES.find((t) => t.id === template) || {}).label || 'Message'; const subject = 'Isheeka Events — ' + label; window.open('mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body), '_blank'); logEmail({ to: email, subject, body, party_type: partyType, party_id: partyId, template }).catch(() => {}); setSent(true); if (onSent) setTimeout(onSent, 1200); };

  const who = contact.name || contact.first_name;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '24px 28px', width: 480, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>💬 Send Message{who ? (' — ' + who) : ''}</div>
          <button className="btn sm" onClick={() => onClose && onClose()}>✕ Close</button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-500)', display: 'block', marginBottom: 4 }}>Template</label>
          <select className="field-input" value={template} onChange={(e) => onTemplate(e.target.value)} style={{ width: '100%' }}>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-500)', display: 'block', marginBottom: 4 }}>Message</label>
          <textarea className="field-input" value={body} onChange={(e) => setBody(e.target.value)} rows={8} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} placeholder="Type your message…" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-500)', display: 'block', marginBottom: 4 }}>Phone number (for this send)</label>
          <input className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: '100%' }} placeholder="+91 98765 43210" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--grey-500)', display: 'block', marginBottom: 4 }}>Email (for this send)</label>
          <input className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} placeholder="name@email.com" type="email" />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={doWA} disabled={!phone || !body}>📲 Send on WhatsApp</button>
          <button className="btn" onClick={doEmail} disabled={!email || !body}>📧 Send by Email</button>
          {sent && <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>✅ Sent</span>}
        </div>
      </div>
    </div>
  );
}

export default SendMessageModal;
