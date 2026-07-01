// Users module (staff directory — Option A). Single screen: list + add/edit modal.
// Manages the public.users directory only (name, email, phone, role, status) — this
// drives "assigned to" dropdowns + audit attribution (the app matches a login to a
// users row BY EMAIL). LOGINS themselves are created in Supabase Studio (Auth → Add
// user) with a MATCHING email; see the in-form note. Role-based ACCESS is not yet
// enforced (every authenticated user sees everything) — that's a later, separate piece.
import React from 'react';
import { supabase } from '../lib/supabase';
import { notify, runDb } from '../lib/toast.jsx';
import { confirmDialog } from '../components/confirm.jsx';

const ROLE_OPTS = [['admin', 'Admin'], ['manager', 'Manager'], ['staff', 'Staff']];
const roleLabel = (r) => (ROLE_OPTS.find((x) => x[0] === r) || [r, r])[1];
const roleColor = (r) => ({
  admin: { bg: 'var(--pink-light)', color: 'var(--pink-dark)' },
  manager: { bg: 'var(--blue-light)', color: 'var(--blue)' },
  staff: { bg: 'var(--grey-100)', color: 'var(--grey-400)' },
}[r] || { bg: 'var(--grey-100)', color: 'var(--grey-400)' });
const stColor = (s) => (s === 'active'
  ? { bg: 'var(--green-light)', color: 'var(--green)' }
  : { bg: 'var(--grey-100)', color: 'var(--grey-400)' });

export function UsersModule() {
  const [users, setUsers] = React.useState([]);
  const [myEmail, setMyEmail] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [roleF, setRoleF] = React.useState('');
  const [statusF, setStatusF] = React.useState('');
  const [showForm, setShowForm] = React.useState(false);
  const [editU, setEditU] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const emptyU = { first_name: '', last_name: '', email: '', phone: '+91 ', role: 'staff', status: 'active' };
  const [form, setForm] = React.useState(emptyU);
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = React.useCallback(async () => {
    setLoading(true);
    const [{ data: u }, { data: auth }] = await Promise.all([
      supabase.from('users').select('*').eq('is_deleted', false).order('first_name'),
      supabase.auth.getUser(),
    ]);
    setUsers(u || []);
    setMyEmail((auth && auth.user && auth.user.email) || '');
    setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const isMe = (u) => myEmail && (u.email || '').trim().toLowerCase() === myEmail.trim().toLowerCase();
  const cnt = (f) => users.filter(f).length;
  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    const ms = !q || `${u.first_name || ''} ${u.last_name || ''} ${u.email || ''} ${u.phone || ''}`.toLowerCase().includes(q);
    return ms && (!roleF || u.role === roleF) && (!statusF || u.status === statusF);
  });

  const openNew = () => { setEditU(null); setForm({ ...emptyU }); setShowForm(true); };
  const openEdit = (u) => { setEditU(u); setForm({ ...emptyU, ...u, phone: u.phone || '+91 ' }); setShowForm(true); };

  const save = async () => {
    const fn = form.first_name.trim(), ln = form.last_name.trim(), em = form.email.trim().toLowerCase();
    if (!fn || !ln) { notify('First and last name are required.', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { notify('Enter a valid email address.', 'error'); return; }
    const dup = users.find((u) => (u.email || '').trim().toLowerCase() === em && (!editU || u.user_id !== editU.user_id));
    if (dup) { notify('A staff member with that email already exists.', 'error'); return; }
    setSaving(true);
    const now = new Date().toISOString();
    const payload = {
      first_name: fn, last_name: ln, email: em,
      phone: (form.phone || '').trim() || null,
      role: form.role || 'staff', status: form.status || 'active', updated_at: now,
    };
    let err;
    if (editU) {
      ({ error: err } = await runDb(supabase.from('users').update(payload).eq('user_id', editU.user_id), 'update staff'));
    } else {
      payload.created_at = now; payload.date_joined = now; payload.is_deleted = false;
      ({ error: err } = await runDb(supabase.from('users').insert(payload), 'add staff'));
    }
    setSaving(false);
    if (err) return;
    notify(editU ? 'Staff member updated.' : 'Staff member added.', 'success');
    setShowForm(false); load();
  };

  const setStatus = async (u, st) => {
    if (st === u.status) return;
    if (isMe(u) && st === 'inactive') { notify("You can't deactivate your own account.", 'error'); return; }
    const { error } = await runDb(supabase.from('users').update({ status: st, updated_at: new Date().toISOString() }).eq('user_id', u.user_id), 'update status');
    if (!error) { notify('Status updated.', 'success'); load(); }
  };

  const del = async (u) => {
    if (isMe(u)) { notify("You can't remove your own account.", 'error'); return; }
    if (!await confirmDialog('Remove ' + u.first_name + ' ' + u.last_name + ' from the staff directory? Their past activity records are preserved. (Their login, if any, must be removed separately in Supabase Studio.)')) return;
    const { error } = await runDb(supabase.from('users').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('user_id', u.user_id), 'remove staff');
    if (!error) { notify('Staff member removed.', 'success'); load(); }
  };

  const formModal = (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
      <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 540 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>{editU ? 'Edit staff member' : 'New staff member'}</div>
          <button className="btn sm" onClick={() => setShowForm(false)}>✕</button>
        </div>
        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1', background: 'var(--blue-light)', border: '1px solid #93C5FD', borderRadius: 'var(--radius-md)', padding: '10px 12px', fontSize: 12.5, color: 'var(--blue)' }}>
            💡 This adds a directory record (name, role, task attribution). To let this person <b>sign in</b>, also create their login in <b>Supabase Studio → Authentication → Add user</b> using the <b>same email</b> — signups are disabled, so accounts are created by you.
          </div>
          <div><label className="field-label">First name <span style={{ color: 'var(--pink)' }}>*</span></label><input className="field-input" value={form.first_name} onChange={(e) => setF('first_name', e.target.value)} placeholder="e.g. Priya" /></div>
          <div><label className="field-label">Last name <span style={{ color: 'var(--pink)' }}>*</span></label><input className="field-input" value={form.last_name} onChange={(e) => setF('last_name', e.target.value)} placeholder="e.g. Sharma" /></div>
          <div style={{ gridColumn: '1 / -1' }}><label className="field-label">Email <span style={{ color: 'var(--pink)' }}>*</span></label><input className="field-input" value={form.email} onChange={(e) => setF('email', e.target.value)} placeholder="name@isheeka.com" /><div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 3 }}>Must match their Supabase login email for sign-in + attribution to work.</div></div>
          <div><label className="field-label">Phone</label><input className="field-input" value={form.phone} onChange={(e) => setF('phone', e.target.value)} placeholder="+91 98765 43210" /></div>
          <div><label className="field-label">Role</label><select className="field-input" value={form.role} onChange={(e) => setF('role', e.target.value)}>{ROLE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="field-label">Status</label><select className="field-input" value={form.status} onChange={(e) => setF('status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={() => setShowForm(false)}>Cancel</button>
          <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : (editU ? 'Save changes' : 'Add staff member')}</button>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {showForm && formModal}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--grey-800)' }}>Users</div>
        <button className="btn primary" onClick={openNew}>+ New staff member</button>
      </div>
      <div className="metrics-grid" style={{ marginBottom: 18 }}>
        <div className="metric-card pink"><div className="metric-icon">👤</div><div className="metric-value">{users.length}</div><div className="metric-label">Total</div></div>
        <div className="metric-card green"><div className="metric-icon">✅</div><div className="metric-value">{cnt((u) => u.status === 'active')}</div><div className="metric-label">Active</div></div>
        <div className="metric-card blue"><div className="metric-icon">🛡️</div><div className="metric-value">{cnt((u) => u.role === 'admin')}</div><div className="metric-label">Admins</div></div>
        <div className="metric-card orange"><div className="metric-icon">🚫</div><div className="metric-value">{cnt((u) => u.status === 'inactive')}</div><div className="metric-label">Inactive</div></div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 180, position: 'relative' }}><span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--grey-400)', pointerEvents: 'none' }}>🔍</span><input className="field-input" style={{ paddingLeft: 36 }} placeholder="Search name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="field-input" style={{ width: 140 }} value={roleF} onChange={(e) => setRoleF(e.target.value)}><option value="">All roles</option>{ROLE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="field-input" style={{ width: 130 }} value={statusF} onChange={(e) => setStatusF(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
      </div>
      {loading ? <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        : filtered.length === 0 ? <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: 50, textAlign: 'center', border: '1px solid var(--grey-100)', color: 'var(--grey-400)' }}>No staff members. <button className="btn sm" onClick={openNew}>+ Add one</button></div>
          : <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--grey-100)', overflow: 'hidden' }}>
            {filtered.map((u, i) => { const rc = roleColor(u.role); const sc = stColor(u.status); return (
              <div key={u.user_id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 110px 1fr 110px auto', gap: 12, alignItems: 'center', padding: '12px 16px', borderTop: i > 0 ? '1px solid var(--grey-100)' : 'none', opacity: u.status === 'inactive' ? 0.6 : 1 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--pink-light)', color: 'var(--pink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>{((u.first_name || '?')[0] + (u.last_name || '')[0]).toUpperCase()}</div>
                <div><div style={{ fontSize: 14, fontWeight: 500, color: 'var(--grey-800)' }}>{u.first_name} {u.last_name} {isMe(u) && <span style={{ fontSize: 11, color: 'var(--grey-400)' }}>(You)</span>}</div><div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{u.email}{u.phone ? (' · ' + u.phone) : ''}</div></div>
                <div><span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 12, background: rc.bg, color: rc.color }}>{roleLabel(u.role)}</span></div>
                <div>
                  <select className="field-input" style={{ width: 120, fontSize: 12, padding: '5px 8px' }} value={u.status} onChange={(e) => setStatus(u, e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select>
                </div>
                <div><span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 12, background: sc.bg, color: sc.color }}>{(u.status || '').toUpperCase()}</span></div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="btn sm" onClick={() => openEdit(u)}>✏️ Edit</button>
                  {!isMe(u) && <button className="btn sm" style={{ color: 'var(--red)', borderColor: 'rgba(163,45,45,0.3)' }} onClick={() => del(u)}>🗑</button>}
                </div>
              </div>
            ); })}
          </div>}
    </div>
  );
}
