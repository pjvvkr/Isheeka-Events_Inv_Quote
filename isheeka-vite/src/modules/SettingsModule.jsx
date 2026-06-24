// Settings module — Company / Bank / Documents / Terms forms + Templates,
// Lead Sources, and Event Types (with per-type Functions) admin tabs.
// Ported verbatim from isheeka-erp-v22.html (cache-clears use data.js exports).
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { notify, runDb } from '../lib/toast.jsx';
import { fetchSuggestions, InputField, SelectField } from '../components/fields.jsx';
import { useEventTypes, clearLeadSourcesCache, clearEventTypesCache } from '../lib/data.js';
import { eventTypeLabel } from '../lib/format.js';

// Stable inputs for template editor
function TplNameInput({ value, onChange }) {
  const [suggestions, setSuggestions] = React.useState([]);
  const [filtered, setFiltered] = React.useState([]);
  const [open, setOpen] = React.useState(false);

  const handleFocus = async () => {
    const s1 = await fetchSuggestions('sub_events', 'name');
    const s2 = await fetchSuggestions('event_template_items', 'sub_event_name');
    const suggs = [...new Set([...s1, ...s2])];
    setSuggestions(suggs);
    const q = (value || '').toLowerCase();
    const f = q ? suggs.filter((s) => s.toLowerCase().includes(q)) : suggs;
    setFiltered(f); if (f.length > 0) setOpen(true);
  };
  const handleChange = (val) => {
    onChange(val);
    const q = val.toLowerCase();
    setFiltered(q ? suggestions.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q) : suggestions);
    setOpen(true);
  };
  const handleSelect = (val) => { onChange(val); setOpen(false); };

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <input style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 13, fontWeight: 500, outline: 'none', color: 'var(--grey-800)', borderBottom: '1px solid var(--grey-200)', padding: '2px 4px' }}
        value={value} onChange={(e) => handleChange(e.target.value)}
        onFocus={handleFocus} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Sub-event name" />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 500, background: 'white', border: '1.5px solid var(--pink)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', minWidth: 180, maxHeight: 160, overflowY: 'auto' }}>
          {filtered.map((s, i) => (
            <div key={i} onMouseDown={() => handleSelect(s)}
              style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', color: 'var(--grey-800)', borderBottom: '1px solid var(--grey-100)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--pink-light)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function TplDescInput({ value, onChange, onPaste }) {
  const [suggestions, setSuggestions] = React.useState([]);
  const [filtered, setFiltered] = React.useState([]);
  const [open, setOpen] = React.useState(false);

  const handleFocus = async () => {
    const suggs = await fetchSuggestions('event_template_items', 'description');
    setSuggestions(suggs);
    const q = (value || '').toLowerCase();
    const f = q ? suggs.filter((s) => s.toLowerCase().includes(q)) : suggs;
    setFiltered(f); if (f.length > 0) setOpen(true);
  };
  const handleChange = (val) => {
    onChange(val);
    const q = val.toLowerCase();
    setFiltered(q ? suggestions.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q) : suggestions);
    setOpen(true);
  };
  const handleSelect = (val) => { onChange(val); setOpen(false); };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input style={{ border: 'none', background: 'transparent', fontSize: 13, width: '100%', outline: 'none', color: 'var(--grey-800)' }}
        value={value} onChange={(e) => handleChange(e.target.value)} onPaste={onPaste}
        onFocus={handleFocus} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Item description" />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 500, background: 'white', border: '1.5px solid var(--pink)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', minWidth: 220, maxHeight: 160, overflowY: 'auto' }}>
          {filtered.map((s, i) => (
            <div key={i} onMouseDown={() => handleSelect(s)}
              style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: 'var(--grey-800)', borderBottom: '1px solid var(--grey-100)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--pink-light)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function TplQtyInput({ value, onChange }) {
  return <input type="number" style={{ border: 'none', background: 'transparent', fontSize: 13, width: '100%', outline: 'none', textAlign: 'right', color: 'var(--grey-800)', MozAppearance: 'textfield' }} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function TemplateEditor({ template, onSave, onCancel }) {
  const [name, setName] = React.useState(template?.name || '');
  const [eventType, setEventType] = React.useState(template?.event_type || '');
  const [subEvents, setSubEvents] = React.useState([]);
  const [loading, setLoading] = React.useState(!!template?.template_id);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');

  React.useEffect(() => {
    if (template?.template_id) {
      supabase.from('event_template_items').select('*').eq('template_id', template.template_id).order('sub_event_name').order('sort_order').then(({ data }) => {
        if (data) {
          const groups = {};
          data.forEach((item) => {
            if (!groups[item.sub_event_name]) groups[item.sub_event_name] = { id: 'se-' + item.sub_event_name, name: item.sub_event_name, items: [] };
            groups[item.sub_event_name].items.push({ id: item.item_id, description: item.description, default_quantity: item.default_quantity, sort_order: item.sort_order });
          });
          setSubEvents(Object.values(groups));
        }
        setLoading(false);
      });
    } else {
      setSubEvents([{ id: 'se-' + Date.now(), name: 'Main Event', items: [{ id: 'i-' + Date.now(), description: '', default_quantity: 1, sort_order: 0 }] }]);
      setLoading(false);
    }
  }, []);

  const addSubEvent = () => setSubEvents((s) => [...s, { id: 'se-' + Date.now(), name: '', items: [{ id: 'i-' + Date.now(), description: '', default_quantity: 1, sort_order: 0 }] }]);
  const removeSubEvent = (id) => setSubEvents((s) => s.filter((se) => se.id !== id));
  const updateSEName = (id, val) => setSubEvents((s) => s.map((se) => se.id === id ? { ...se, name: val } : se));
  const addItem = (seId) => setSubEvents((s) => s.map((se) => se.id === seId ? { ...se, items: [...se.items, { id: 'i-' + Date.now(), description: '', default_quantity: 1, sort_order: se.items.length }] } : se));
  const removeItem = (seId, iId) => setSubEvents((s) => s.map((se) => se.id === seId ? { ...se, items: se.items.filter((i) => i.id !== iId) } : se));
  const updateItem = (seId, iId, field, val) => setSubEvents((s) => s.map((se) => se.id === seId ? { ...se, items: se.items.map((i) => i.id === iId ? { ...i, [field]: val } : i) } : se));
  // ── Bulk paste from Excel ──
  const [pasteFor, setPasteFor] = React.useState(null); // sub-event id or '__all__'
  const [pasteText, setPasteText] = React.useState('');
  const uid6 = () => Math.random().toString(36).slice(2, 8);
  const parsePasted = (text, force2) => {
    const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    let maxc = 1; lines.forEach((l) => { const c = l.split('\t').length; if (c > maxc) maxc = c; });
    const mode = force2 ? 2 : (maxc >= 3 ? 3 : (maxc === 2 ? 2 : 1));
    const rows = lines.map((l) => { const p = l.split('\t');
      if (mode >= 3) return { subEvent: (p[0] || '').trim(), description: (p[1] || '').trim(), qty: parseFloat(p[2]) || 1 };
      return { description: (p[0] || '').trim(), qty: (mode === 2 ? (parseFloat(p[1]) || 1) : 1) };
    }).filter((r) => r.description);
    return { mode, rows };
  };
  const pasteParsed = pasteText.trim() ? parsePasted(pasteText) : { mode: 0, rows: [] };
  const applyBulkPaste = () => {
    const { mode, rows } = pasteParsed;
    if (rows.length === 0) { notify('No rows detected to add.', 'error'); return; }
    if (mode >= 3) {
      setSubEvents((prev) => {
        const byKey = {}, order = [];
        prev.forEach((se) => { const k = (se.name || '').trim().toLowerCase(); byKey[k] = { ...se, items: [...se.items] }; order.push(k); });
        rows.forEach((r) => { const nm = r.subEvent || 'Main Event', k = nm.trim().toLowerCase();
          if (!byKey[k]) { byKey[k] = { id: 'se-' + Date.now() + uid6(), name: nm, items: [] }; order.push(k); }
          byKey[k].items.push({ id: 'i-' + Date.now() + uid6(), description: r.description, default_quantity: r.qty, sort_order: byKey[k].items.length });
        });
        return order.map((k) => byKey[k]);
      });
    } else {
      const seId = pasteFor;
      setSubEvents((prev) => prev.map((se) => se.id === seId ? { ...se, items: [...se.items, ...rows.map((r, k) => ({ id: 'i-' + Date.now() + uid6() + k, description: r.description, default_quantity: r.qty, sort_order: se.items.length + k }))] } : se));
    }
    notify('Added ' + rows.length + ' item' + (rows.length > 1 ? 's' : '') + '.', 'success');
    setPasteFor(null); setPasteText('');
  };
  const handleCellPaste = (seId, itemId, e) => {
    const text = ((e.clipboardData || window.clipboardData) || {}).getData ? (e.clipboardData || window.clipboardData).getData('text') : '';
    if (!text || !/[\n\t]/.test(text)) return; // single value → let it paste normally
    e.preventDefault();
    const { rows } = parsePasted(text, true); // cell paste = 2-col semantics into this sub-event
    if (rows.length === 0) return;
    setSubEvents((prev) => prev.map((se) => { if (se.id !== seId) return se;
      const items = [...se.items]; const idx = items.findIndex((i) => i.id === itemId);
      const mapped = rows.map((r) => ({ id: 'i-' + Date.now() + uid6(), description: r.description, default_quantity: r.qty, sort_order: 0 }));
      if (idx >= 0) items.splice(idx, 1, ...mapped); else items.push(...mapped);
      return { ...se, items: items.map((it, n) => ({ ...it, sort_order: n })) };
    }));
    notify('Pasted ' + rows.length + ' row' + (rows.length > 1 ? 's' : '') + '.', 'success');
  };

  const moveSE = (idx, dir) => {
    const s = [...subEvents];
    const to = idx + dir;
    if (to < 0 || to >= s.length) return;
    [s[idx], s[to]] = [s[to], s[idx]];
    setSubEvents(s);
  };

  const handleSave = async () => {
    if (!name.trim()) { setSaveError('Template name is required'); return; }
    if (subEvents.length === 0) { setSaveError('Add at least one sub-event'); return; }
    setSaving(true); setSaveError('');
    try {
      let tplId = template?.template_id;
      if (tplId) {
        const { error: tue } = await supabase.from('event_templates').update({ name, event_type: eventType || null, updated_at: new Date().toISOString() }).eq('template_id', tplId); if (tue) throw tue;
        const { error: tdie } = await supabase.from('event_template_items').delete().eq('template_id', tplId); if (tdie) throw tdie;
      } else {
        const { data, error: tie } = await supabase.from('event_templates').insert({ name, event_type: eventType || null, is_active: true, sort_order: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_deleted: false }).select().single();
        if (tie) throw tie;
        tplId = data.template_id;
      }
      const allItems = [];
      subEvents.forEach((se, si) => {
        se.items.forEach((item, ii) => {
          if (item.description.trim()) {
            allItems.push({ template_id: tplId, sub_event_name: se.name || 'Main Event', description: item.description, default_quantity: parseFloat(item.default_quantity) || 1, sort_order: ii, created_at: new Date().toISOString() });
          }
        });
      });
      if (allItems.length > 0) { const { error: tiie } = await supabase.from('event_template_items').insert(allItems); if (tiie) throw tiie; }
      notify('Template saved!', 'success');
      onSave();
    } catch (err) { console.error('[Isheeka ERP] template save failed:', err); setSaveError('Could not save template: ' + ((err && (err.message || err.details || err.hint)) || 'please try again.')); }
    finally { setSaving(false); }
  };

  const eventTypes = useEventTypes();
  const typeOpts = eventTypes.map((t) => ({ value: t.value, label: t.label }));

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>{template?.template_id ? 'Edit template' : 'New template'}</div>
        <button className="btn sm" onClick={onCancel}>✕ Cancel</button>
      </div>
      {saveError && <div style={{ background: 'var(--red-light)', color: 'var(--red)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, marginBottom: 16, border: '1px solid rgba(163,45,45,0.2)' }}>⚠️ {saveError}</div>}
      <div className="form-grid" style={{ marginBottom: 20 }}>
        <InputField label="Template name" required value={name} onChange={setName} placeholder="e.g. Wedding, Corporate - Large" />
        <SelectField label="Event type" value={eventType} onChange={setEventType} options={typeOpts} placeholder="Select event type..." />
      </div>
      <div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 4 }}>💡 Note: No prices in templates — prices are entered per event</div>
      <div style={{ height: 1, background: 'var(--grey-100)', marginBottom: 16 }} />

      {subEvents.map((se, si) => (
        <div key={se.id} style={{ background: 'var(--grey-50)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 12, border: '1px solid var(--grey-100)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--grey-200)' }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#e8185a', flexShrink: 0 }}></div>
            <TplNameInput value={se.name} onChange={(v) => updateSEName(se.id, v)} />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn sm" onClick={() => moveSE(si, -1)} disabled={si === 0} style={{ padding: '2px 8px', opacity: si === 0 ? .3 : 1 }}>↑</button>
              <button className="btn sm" onClick={() => moveSE(si, 1)} disabled={si === subEvents.length - 1} style={{ padding: '2px 8px', opacity: si === subEvents.length - 1 ? .3 : 1 }}>↓</button>
              <button className="btn sm" style={{ color: 'var(--red)', padding: '2px 8px' }} onClick={() => removeSubEvent(se.id)}>🗑</button>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FCEAF1' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#A01044', textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: '1.5px solid #e8185a' }}>Description</th>
                <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: '#A01044', textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: '1.5px solid #e8185a', width: '15%' }}>Default qty</th>
                <th style={{ borderBottom: '1.5px solid #e8185a', width: '6%' }}></th>
              </tr>
            </thead>
            <tbody>
              {se.items.map((item, ii) => (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--grey-100)' }}>
                  <td style={{ padding: '6px 8px' }}><TplDescInput value={item.description} onChange={(v) => updateItem(se.id, item.id, 'description', v)} onPaste={(e) => handleCellPaste(se.id, item.id, e)} /></td>
                  <td style={{ padding: '6px 8px' }}><TplQtyInput value={item.default_quantity} onChange={(v) => updateItem(se.id, item.id, 'default_quantity', v)} /></td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}><button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--grey-400)', fontSize: 13 }} onClick={() => removeItem(se.id, item.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn sm" style={{ border: '1px dashed var(--grey-200)', color: 'var(--grey-400)' }} onClick={() => addItem(se.id)}>+ Add item</button>
            <button className="btn sm" style={{ border: '1px dashed var(--pink-mid)', color: 'var(--pink-dark)' }} onClick={() => { setPasteFor(se.id); setPasteText(''); }}>⎘ Paste from Excel</button>
            <span style={{ fontSize: 11, color: 'var(--grey-400)' }}>tip: you can also paste a column straight into a description cell</span>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 20 }}>
        <button className="btn" style={{ border: '1px dashed var(--grey-200)', color: 'var(--grey-400)' }} onClick={addSubEvent}>+ Add sub-event</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 16, borderTop: '1px solid var(--grey-100)' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={handleSave} disabled={saving}>{saving ? '⏳ Saving...' : '💾 Save template'}</button>
      </div>

      {pasteFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1300, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) setPasteFor(null); }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 560 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grey-800)' }}>Paste items from Excel</div><button className="btn sm" onClick={() => setPasteFor(null)}>✕</button></div>
            <div style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 12, color: 'var(--grey-500)', marginBottom: 8, lineHeight: 1.6 }}>Copy cells from Excel and paste below. Columns are auto-detected:<br /><b>2 columns</b> = Description &nbsp;⇥&nbsp; Qty → added to <b>{(subEvents.find((s) => s.id === pasteFor) || {}).name || 'this sub-event'}</b>. &nbsp; <b>3 columns</b> = Sub-event &nbsp;⇥&nbsp; Description &nbsp;⇥&nbsp; Qty → builds/merges all sub-events. Qty optional (defaults to 1).</div>
              <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={9} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, padding: '8px 10px', border: '1px solid var(--grey-200)', borderRadius: 'var(--radius-md)', resize: 'vertical' }} placeholder={'Stage Decoration\t1\nEntrance Arch\t1\nPathway\t2\nWelcome Girls\t4'} />
              <div style={{ fontSize: 12, color: pasteParsed.rows.length ? 'var(--green)' : 'var(--grey-400)', marginTop: 8 }}>{pasteParsed.rows.length ? ('✓ ' + pasteParsed.rows.length + ' row' + (pasteParsed.rows.length > 1 ? 's' : '') + ' detected · ' + (pasteParsed.mode >= 3 ? '3 columns (builds sub-events)' : (pasteParsed.mode === 2 ? '2 columns' : '1 column'))) : 'Nothing detected yet — paste rows above.'}</div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--grey-100)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button className="btn" onClick={() => setPasteFor(null)}>Cancel</button><button className="btn primary" disabled={!pasteParsed.rows.length} onClick={applyBulkPaste}>{pasteParsed.rows.length ? ('Add ' + pasteParsed.rows.length + ' item' + (pasteParsed.rows.length > 1 ? 's' : '')) : 'Add items'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState('list'); // list | new | edit
  const [editingTemplate, setEditingTemplate] = React.useState(null);

  React.useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    setLoading(true);
    const { data } = await supabase.from('event_templates').select('*').eq('is_deleted', false).order('sort_order').order('name');
    if (data) setTemplates(data);
    setLoading(false);
  };

  const handleArchive = async (tpl) => {
    if (!window.confirm(`Archive "${tpl.name}"? It will no longer appear in the Events wizard but can be restored.`)) return;
    const { error: tae } = await runDb(supabase.from('event_templates').update({ is_active: false, updated_at: new Date().toISOString() }).eq('template_id', tpl.template_id), 'archive template');
    if (tae) return;
    loadTemplates();
  };

  const handleRestore = async (tpl) => {
    const { error: tre } = await runDb(supabase.from('event_templates').update({ is_active: true, updated_at: new Date().toISOString() }).eq('template_id', tpl.template_id), 'restore template');
    if (tre) return;
    loadTemplates();
  };

  const typeIcons = { wedding: '💍', corporate: '🏢', birthday: '🎂', anniversary: '💑', other: '🎪' };
  const active = templates.filter((t) => t.is_active);
  const archived = templates.filter((t) => !t.is_active);

  if (view === 'new' || view === 'edit') return (
    <TemplateEditor
      template={view === 'edit' ? editingTemplate : null}
      onSave={() => { loadTemplates(); setView('list'); setEditingTemplate(null); }}
      onCancel={() => { setView('list'); setEditingTemplate(null); }}
    />
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <div className="settings-section-title">Event templates</div>
          <div style={{ fontSize: 13, color: 'var(--grey-400)', marginTop: 2, marginBottom: 16 }}>Configure reusable templates for common event types. Templates are starting points only — changes don't affect existing events.</div>
        </div>
        <button className="btn primary" onClick={() => setView('new')}>+ New template</button>
      </div>

      {loading ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div> : (
        <>
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--grey-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Active ({active.length})</div>
          {active.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: 'var(--grey-400)', fontSize: 13, background: 'var(--grey-50)', borderRadius: 'var(--radius-md)', marginBottom: 16 }}>No active templates. Create one!</div>}
          {active.map((tpl) => (
            <div key={tpl.template_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'white', borderRadius: 'var(--radius-md)', border: '1px solid var(--grey-100)', marginBottom: 8, transition: 'border-color .15s' }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--grey-200)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--grey-100)'}>
              <span style={{ fontSize: 24 }}>{typeIcons[tpl.event_type] || '🎪'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--grey-800)' }}>{tpl.name}</div>
                <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{tpl.event_type ? eventTypeLabel(tpl.event_type) : 'General'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm" onClick={() => { setEditingTemplate(tpl); setView('edit'); }}>✏️ Edit</button>
                <button className="btn sm" style={{ color: 'var(--orange)' }} onClick={() => handleArchive(tpl)}>📦 Archive</button>
              </div>
            </div>
          ))}

          {archived.length > 0 && (
            <>
              <div style={{ marginTop: 20, marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--grey-400)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Archived ({archived.length})</div>
              {archived.map((tpl) => (
                <div key={tpl.template_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--grey-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--grey-100)', marginBottom: 6, opacity: .7 }}>
                  <span style={{ fontSize: 20 }}>{typeIcons[tpl.event_type] || '🎪'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-400)', textDecoration: 'line-through' }}>{tpl.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{tpl.event_type ? eventTypeLabel(tpl.event_type) : 'General'}</div>
                  </div>
                  <button className="btn sm" onClick={() => handleRestore(tpl)}>↩ Restore</button>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

function LeadSourceInput({ value, onChange }) {
  return <input className="field-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Trade Show, Instagram..." />;
}

function LeadSourcesTab() {
  const [sources, setSources] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [newLabel, setNewLabel] = React.useState('');
  const [addError, setAddError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [successMsg, setSuccessMsg] = React.useState('');

  React.useEffect(() => { loadSources(); }, []);

  const loadSources = async () => {
    setLoading(true);
    const { data } = await supabase.from('lead_sources').select('*').order('sort_order').order('label');
    if (data) setSources(data);
    clearLeadSourcesCache(); // so LeadForm reloads
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newLabel.trim()) { setAddError('Label is required'); return; }
    const val = newLabel.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    setSaving(true);
    const { error: lsie } = await runDb(supabase.from('lead_sources').insert({
      label: newLabel.trim(), value: val,
      sort_order: sources.length + 1, is_active: true,
      created_at: new Date().toISOString(),
    }), 'add lead source');
    if (lsie) { setSaving(false); return; }
    setNewLabel(''); setAddError('');
    await loadSources();
    setSuccessMsg('Source added!');
    setTimeout(() => setSuccessMsg(''), 3000);
    setSaving(false);
  };

  const toggleActive = async (src) => {
    const { error: lte } = await runDb(supabase.from('lead_sources').update({ is_active: !src.is_active }).eq('source_id', src.source_id), 'update lead source');
    if (lte) return;
    setSources((s) => s.map((x) => x.source_id === src.source_id ? { ...x, is_active: !x.is_active } : x));
    clearLeadSourcesCache();
  };

  const moveUp = async (idx) => {
    if (idx === 0) return;
    const a = sources[idx], b = sources[idx - 1];
    const { error: lm1 } = await runDb(supabase.from('lead_sources').update({ sort_order: b.sort_order }).eq('source_id', a.source_id), 'reorder lead source');
    if (lm1) return;
    const { error: lm2 } = await runDb(supabase.from('lead_sources').update({ sort_order: a.sort_order }).eq('source_id', b.source_id), 'reorder lead source');
    if (lm2) return;
    await loadSources(); clearLeadSourcesCache();
  };

  return (
    <div>
      <div className="settings-section-title">Lead sources</div>
      <div style={{ fontSize: 13, color: 'var(--grey-400)', marginBottom: 16 }}>
        Configure the sources that appear when creating a new lead. These values are shared across the app.
      </div>

      {successMsg && <div style={{ background: 'var(--green-light)', color: 'var(--green)', borderRadius: 'var(--radius-sm)', padding: '8px 14px', fontSize: 13, marginBottom: 12 }}>✅ {successMsg}</div>}

      {loading ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div> : (
        <>
          <div style={{ background: 'white', borderRadius: 'var(--radius-md)', border: '1px solid var(--grey-100)', overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ padding: '8px 16px', background: 'var(--pink-light)', display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, fontSize: 11, fontWeight: 700, color: 'var(--pink)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              <div>Label</div><div>Order</div><div>Status</div><div></div>
            </div>
            {sources.map((src, i) => (
              <div key={src.source_id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--grey-100)', opacity: src.is_active ? 1 : .5 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-800)' }}>{src.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--grey-400)', fontFamily: 'monospace' }}>{src.value}</div>
                </div>
                <button className="btn sm" onClick={() => moveUp(i)} disabled={i === 0} style={{ opacity: i === 0 ? .3 : 1, padding: '2px 8px' }}>↑</button>
                <button className="btn sm" style={{ fontSize: 11, color: src.is_active ? 'var(--green)' : 'var(--grey-400)', borderColor: src.is_active ? 'var(--green)' : 'var(--grey-200)' }}
                  onClick={() => toggleActive(src)}>
                  {src.is_active ? 'Active' : 'Inactive'}
                </button>
                <div style={{ width: 20 }} />
              </div>
            ))}
            {sources.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--grey-400)', fontSize: 13 }}>No sources yet</div>}
          </div>

          <div style={{ background: 'var(--grey-50)', borderRadius: 'var(--radius-md)', padding: 16, border: '1px solid var(--grey-100)' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-800)', marginBottom: 10 }}>Add new source</div>
            {addError && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>⚠ {addError}</div>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">Source label</label>
                <LeadSourceInput value={newLabel} onChange={(v) => { setNewLabel(v); setAddError(''); }} />
              </div>
              <button className="btn primary" onClick={handleAdd} disabled={saving} style={{ flexShrink: 0 }}>
                {saving ? 'Adding...' : '+ Add source'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 6 }}>
              The value will be auto-generated from the label (e.g. "Trade Show" → trade_show)
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SubEventEditor({ eventTypeId }) {
  const [subs, setSubs] = React.useState([]);
  const [val, setVal] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const load = async () => { setLoading(true); const { data } = await supabase.from('event_type_subevents').select('*').eq('event_type_id', eventTypeId).order('sort_order'); setSubs(data || []); setLoading(false); };
  React.useEffect(() => { load(); }, [eventTypeId]);
  const add = async () => { const n = val.trim(); if (!n) return; if (subs.some((s) => (s.name || '').toLowerCase() === n.toLowerCase())) { notify('That function already exists.', 'error'); return; } const { error } = await runDb(supabase.from('event_type_subevents').insert({ event_type_id: eventTypeId, name: n, sort_order: subs.length, is_active: true }), 'add function'); if (error) return; setVal(''); load(); };
  const remove = async (s) => { if (!window.confirm('Remove "' + s.name + '"?')) return; const { error } = await runDb(supabase.from('event_type_subevents').delete().eq('subevent_id', s.subevent_id), 'remove function'); if (error) return; load(); };
  const toggle = async (s) => { const { error } = await runDb(supabase.from('event_type_subevents').update({ is_active: !s.is_active }).eq('subevent_id', s.subevent_id), 'update function'); if (error) return; load(); };
  const moveUp = async (i) => { if (i === 0) return; const a = subs[i], b = subs[i - 1]; await runDb(supabase.from('event_type_subevents').update({ sort_order: b.sort_order }).eq('subevent_id', a.subevent_id), 'reorder'); await runDb(supabase.from('event_type_subevents').update({ sort_order: a.sort_order }).eq('subevent_id', b.subevent_id), 'reorder'); load(); };
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: 'var(--gold)', marginBottom: 6 }}>FUNCTIONS (SUB-EVENTS)</div>
      {loading ? <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>Loading…</div> :
        subs.length === 0 ? <div style={{ fontSize: 12, color: 'var(--grey-400)', marginBottom: 8 }}>No functions yet — add the typical ones (e.g. Mehendi, Haldi).</div> :
          subs.map((s, i) => (
            <div key={s.subevent_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 13, opacity: s.is_active ? 1 : .5 }}>
              <button className="btn sm" style={{ padding: '1px 7px' }} disabled={i === 0} onClick={() => moveUp(i)}>↑</button>
              <span style={{ flex: 1 }}>{s.name}</span>
              <button className="btn sm" style={{ fontSize: 11, padding: '1px 8px', color: s.is_active ? 'var(--green)' : 'var(--grey-400)' }} onClick={() => toggle(s)}>{s.is_active ? 'Active' : 'Inactive'}</button>
              <button className="btn sm" style={{ fontSize: 11, padding: '1px 8px', color: 'var(--red)' }} onClick={() => remove(s)}>✕</button>
            </div>
          ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input className="field-input" style={{ flex: 1, fontSize: 13, padding: '6px 10px' }} value={val} onChange={(e) => setVal(e.target.value)} placeholder="Add a function (e.g. Sangeeth)" onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button className="btn sm primary" onClick={add}>+ Add</button>
      </div>
    </div>
  );
}

function EventTypesTab() {
  const [types, setTypes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [newLabel, setNewLabel] = React.useState('');
  const [addError, setAddError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [successMsg, setSuccessMsg] = React.useState('');
  const [expanded, setExpanded] = React.useState(null);

  React.useEffect(() => { loadTypes(); }, []);

  const loadTypes = async () => {
    setLoading(true);
    const { data } = await supabase.from('event_types').select('*').order('sort_order').order('label');
    if (data) setTypes(data);
    clearEventTypesCache(); // clear so forms reload
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newLabel.trim()) { setAddError('Label is required'); return; }
    const val = newLabel.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!val) { setAddError('Enter a valid label'); return; }
    const dup = types.find((t) => t.value === val || (t.label || '').trim().toLowerCase() === newLabel.trim().toLowerCase());
    if (dup) { setAddError('"' + (dup.label || val) + '" already exists' + (dup.is_active ? '.' : ' but is inactive — reactivate it below instead of re-adding.')); return; }
    setSaving(true);
    const { error: eie } = await runDb(supabase.from('event_types').insert({
      label: newLabel.trim(), value: val,
      sort_order: types.length + 1, is_active: true,
      created_at: new Date().toISOString(),
    }), 'add event type');
    if (eie) { setSaving(false); return; }
    setNewLabel(''); setAddError('');
    await loadTypes();
    setSuccessMsg('Event type added!');
    setTimeout(() => setSuccessMsg(''), 3000);
    setSaving(false);
  };

  const toggleActive = async (t) => {
    const { error: ete } = await runDb(supabase.from('event_types').update({ is_active: !t.is_active }).eq('event_type_id', t.event_type_id), 'update event type');
    if (ete) return;
    setTypes((s) => s.map((x) => x.event_type_id === t.event_type_id ? { ...x, is_active: !x.is_active } : x));
    clearEventTypesCache();
  };

  const moveUp = async (idx) => {
    if (idx === 0) return;
    const a = types[idx], b = types[idx - 1];
    const { error: em1 } = await runDb(supabase.from('event_types').update({ sort_order: b.sort_order }).eq('event_type_id', a.event_type_id), 'reorder event type');
    if (em1) return;
    const { error: em2 } = await runDb(supabase.from('event_types').update({ sort_order: a.sort_order }).eq('event_type_id', b.event_type_id), 'reorder event type');
    if (em2) return;
    await loadTypes(); clearEventTypesCache();
  };

  return (
    <div>
      <div className="settings-section-title">Event types</div>
      <div style={{ fontSize: 13, color: 'var(--grey-400)', marginBottom: 16 }}>
        Configure the event types that appear when creating a lead or event. Deactivating a type hides it from new records but leaves existing events unchanged.
      </div>

      {successMsg && <div style={{ background: 'var(--green-light)', color: 'var(--green)', borderRadius: 'var(--radius-sm)', padding: '8px 14px', fontSize: 13, marginBottom: 12 }}>✅ {successMsg}</div>}

      {loading ? <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div> : (
        <>
          <div style={{ background: 'white', borderRadius: 'var(--radius-md)', border: '1px solid var(--grey-100)', overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ padding: '8px 16px', background: 'var(--pink-light)', display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, fontSize: 11, fontWeight: 700, color: 'var(--pink)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              <div>Label</div><div>Order</div><div>Status</div><div></div>
            </div>
            {types.map((t, i) => (
              <React.Fragment key={t.event_type_id}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--grey-100)', opacity: t.is_active ? 1 : .5 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-800)' }}>{t.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--grey-400)', fontFamily: 'monospace' }}>{t.value}</div>
                  </div>
                  <button className="btn sm" onClick={() => moveUp(i)} disabled={i === 0} style={{ opacity: i === 0 ? .3 : 1, padding: '2px 8px' }}>↑</button>
                  <button className="btn sm" style={{ fontSize: 11, color: t.is_active ? 'var(--green)' : 'var(--grey-400)', borderColor: t.is_active ? 'var(--green)' : 'var(--grey-200)' }}
                    onClick={() => toggleActive(t)}>
                    {t.is_active ? 'Active' : 'Inactive'}
                  </button>
                  <button className="btn sm" style={{ padding: '2px 8px' }} title="Manage functions (sub-events)" onClick={() => setExpanded(expanded === t.event_type_id ? null : t.event_type_id)}>{expanded === t.event_type_id ? '▾' : '▸'}</button>
                </div>
                {expanded === t.event_type_id && <div style={{ borderBottom: '1px solid var(--grey-100)', background: 'var(--grey-50)', padding: '10px 16px' }}><SubEventEditor eventTypeId={t.event_type_id} /></div>}
              </React.Fragment>
            ))}
            {types.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--grey-400)', fontSize: 13 }}>No event types yet</div>}
          </div>

          <div style={{ background: 'var(--grey-50)', borderRadius: 'var(--radius-md)', padding: 16, border: '1px solid var(--grey-100)' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-800)', marginBottom: 10 }}>Add new event type</div>
            {addError && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>⚠ {addError}</div>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">Event type label</label>
                <input className="field-input" value={newLabel} onChange={(e) => { setNewLabel(e.target.value); setAddError(''); }} placeholder="e.g. Baby Shower, Engagement..." />
              </div>
              <button className="btn primary" onClick={handleAdd} disabled={saving} style={{ flexShrink: 0 }}>
                {saving ? 'Adding...' : '+ Add type'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 6 }}>
              The value will be auto-generated from the label (e.g. "Baby Shower" → baby_shower)
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SettingsField({ field, label, required, type = 'text', placeholder = '', readOnly = false, hint = '', rows = 3, form, errors, handleChange }) {
  return (
    <div>
      <label className="field-label">
        {label} {required && <span style={{ color: 'var(--pink)' }}>*</span>}
      </label>
      {type === 'textarea' ? (
        <textarea
          className="field-textarea"
          rows={rows}
          value={form[field] || ''}
          onChange={(e) => handleChange(field, e.target.value)}
          placeholder={placeholder}
          style={errors[field] ? { borderColor: 'var(--red)' } : {}}
        />
      ) : (
        <input
          className="field-input"
          type={type}
          value={form[field] || ''}
          onChange={(e) => handleChange(field, type === 'number' ? parseInt(e.target.value) || 0 : e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          style={errors[field] ? { borderColor: 'var(--red)' } : {}}
        />
      )}
      {errors[field] && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>⚠ {errors[field]}</div>}
      {hint && !errors[field] && <div style={{ fontSize: 11, color: 'var(--grey-400)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function SettingsModule() {
  const [activeTab, setActiveTab] = useState('company');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    setLoading(true);
    const { data } = await supabase.from('settings').select('*').single();
    if (data) { setSettings(data); setForm(data); }
    setLoading(false);
  };

  const handleChange = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false); setSaveError('');
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
  };

  const validateTab = (tab) => {
    const newErrors = {};
    if (tab === 'company') {
      if (!form.company_name?.trim()) newErrors.company_name = 'Company name is required';
      if (!form.email?.trim()) newErrors.email = 'Email is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) newErrors.email = 'Enter a valid email address';
      if (!form.phone_1?.trim()) newErrors.phone_1 = 'Primary phone is required';
      if (!form.street_address?.trim()) newErrors.street_address = 'Street address is required';
      if (!form.city?.trim()) newErrors.city = 'City is required';
      if (!form.state?.trim()) newErrors.state = 'State is required';
    }
    if (tab === 'bank') {
      if (!form.bank_name?.trim()) newErrors.bank_name = 'Bank name is required';
      if (!form.account_number?.trim()) newErrors.account_number = 'Account number is required';
      if (!form.ifsc_code?.trim()) newErrors.ifsc_code = 'IFSC code is required';
    }
    if (tab === 'documents') {
      if (!form.default_validity_days || form.default_validity_days < 1) newErrors.default_validity_days = 'Must be at least 1 day';
      if (!form.default_invoice_due_days || form.default_invoice_due_days < 1) newErrors.default_invoice_due_days = 'Must be at least 1 day';
    }
    if (tab === 'terms') {
      if (!form.default_terms?.trim()) newErrors.default_terms = 'Terms & conditions are required';
    }
    return newErrors;
  };

  const handleSave = async () => {
    const newErrors = validateTab(activeTab);
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setSaveError('Please fill in all required fields before saving.');
      return;
    }
    setSaving(true); setSaveError(''); setErrors({});
    try {
      const { error } = await supabase.from('settings')
        .update({ ...form, updated_at: new Date().toISOString() })
        .eq('setting_id', settings.setting_id);
      if (error) throw error;
      setSaved(true); setSettings(form);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError('Could not save settings. Please try again.');
    } finally { setSaving(false); }
  };

  const tabs = [
    { id: 'company', label: 'Company', icon: '🏢' },
    { id: 'bank', label: 'Bank details', icon: '🏦' },
    { id: 'documents', label: 'Documents', icon: '📄' },
    { id: 'terms', label: 'Terms & conditions', icon: '📜' },
    { id: 'templates', label: 'Templates', icon: '📋' },
    { id: 'lead_sources', label: 'Lead sources', icon: '🏷️' },
    { id: 'event_types', label: 'Event types', icon: '🎉' },
  ];

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}><div className="spinner"></div></div>;

  return (
    <div className="settings-layout">
      <div className="settings-sidebar">
        {tabs.map((tab) => (
          <button key={tab.id}
            className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => { setActiveTab(tab.id); setErrors({}); setSaveError(''); setSaved(false); }}>
            <span style={{ fontSize: 16 }}>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>

      <div className="settings-panel">
        {saveError && (
          <div style={{ background: 'var(--red-light)', color: 'var(--red)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, marginBottom: 16, border: '1px solid rgba(163,45,45,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            ⚠️ {saveError}
          </div>
        )}

        {activeTab === 'company' && (
          <>
            <div className="settings-section-title">Company profile</div>
            <div className="settings-section-sub">
              Your business details that appear on all quotations and invoices.
              Fields marked <span style={{ color: 'var(--pink)' }}>*</span> are required.
            </div>
            <div className="form-grid">
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="company_name" label="Company name" required placeholder="Isheeka Events" />
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="email" label="Email" required type="email" placeholder="isheekaevents@gmail.com" />
            </div>
            <div className="form-grid">
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="notify_email_2" label="Notification email 2 (optional)" type="email" placeholder="second@isheekaevents.com" />
            </div>
            <div style={{ fontSize: 12, color: 'var(--grey-400)', margin: '-4px 0 10px' }}>📬 Submission alerts (client RFQ submitted · vendor bid received) are emailed to the Email above and to Notification email 2 if set.</div>
            <div className="form-grid">
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="phone_1" label="Phone 1" required placeholder="+91 78423 95867" />
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="phone_2" label="Phone 2" placeholder="+91 XXXXX XXXXX" />
            </div>
            <div className="form-grid one">
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="website" label="Website" placeholder="www.isheekaevents.com" />
            </div>
            <hr className="divider" />
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-600)', marginBottom: 12 }}>Address</div>
            <div className="form-grid one">
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="street_address" label="Street address" required placeholder="Candeur 40 Apts" />
            </div>
            <div className="form-grid three">
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="city" label="City" required placeholder="Hyderabad" />
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="state" label="State" required placeholder="Telangana" />
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="pincode" label="Pincode" placeholder="500049" />
            </div>
            <hr className="divider" />
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-600)', marginBottom: 12 }}>Tax details <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--grey-400)' }}>(optional)</span></div>
            <div className="form-grid">
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="gst_number" label="GST number" placeholder="Enter GST number" />
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="pan_number" label="PAN number" placeholder="Enter PAN number" />
            </div>
          </>
        )}

        {activeTab === 'bank' && (
          <>
            <div className="settings-section-title">Bank details</div>
            <div className="settings-section-sub">
              Payment details shown on all invoices and quotations.
              Fields marked <span style={{ color: 'var(--pink)' }}>*</span> are required.
            </div>
            <div className="info-box">ℹ️ These details appear in the Payment Details section of every quotation and invoice PDF.</div>
            <div className="form-grid">
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="bank_name" label="Bank name" required placeholder="ICICI Bank, Miyapur, Hyd" />
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="account_number" label="Account number" required placeholder="058801508710" />
            </div>
            <div className="form-grid">
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="ifsc_code" label="IFSC code" required placeholder="ICIC0000588" />
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="upi_id" label="UPI ID" placeholder="e.g. isheeka@hdfc" />
            </div>
            <div className="form-grid">
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="gst_pct" label="GST %" type="number" placeholder="18" hint="Used on invoices when GST is marked applicable" />
            </div>
            <hr className="divider" />
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-600)', marginBottom: 12 }}>Preview</div>
            <div style={{ background: 'var(--grey-50)', borderRadius: 'var(--radius-md)', padding: '14px 16px', border: '1px solid var(--grey-100)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pink)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Payment details</div>
              <div style={{ fontSize: 13, color: 'var(--grey-600)' }}>
                <strong>Bank:</strong> {form.bank_name || '—'} &nbsp;|&nbsp;
                <strong>Acct:</strong> {form.account_number || '—'} &nbsp;|&nbsp;
                <strong>IFSC:</strong> {form.ifsc_code || '—'}
                {form.upi_id && <> &nbsp;|&nbsp; <strong>UPI:</strong> {form.upi_id}</>}
              </div>
            </div>
          </>
        )}

        {activeTab === 'documents' && (
          <>
            <div className="settings-section-title">Document defaults</div>
            <div className="settings-section-sub">
              Default values used when creating new quotations and invoices.
              Fields marked <span style={{ color: 'var(--pink)' }}>*</span> are required.
            </div>
            <div className="form-grid">
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="default_validity_days" label="Quotation validity (days)" required type="number"
                hint="Default: 7 days from creation date" />
              <SettingsField form={form} errors={errors} handleChange={handleChange} field="default_invoice_due_days" label="Invoice due date (days)" required type="number"
                hint="Default: 14 days from invoice date" />
            </div>
          </>
        )}

        {activeTab === 'terms' && (
          <>
            <div className="settings-section-title">Payment terms & conditions</div>
            <div className="settings-section-sub">
              Default terms that appear on all quotations and invoices.
              Fields marked <span style={{ color: 'var(--pink)' }}>*</span> are required.
            </div>
            <div className="form-grid one">
              <SettingsField
                field="default_terms"
                label="Default additional terms & conditions"
                required
                type="textarea"
                rows={5}
                placeholder="e.g. Any item/service not listed above is not in scope of services."
                form={form} errors={errors} handleChange={handleChange}
              />
            </div>
            <div className="form-grid one">
              <SettingsField
                field="cover_intro"
                label="Cover page intro paragraph (shown on PDF cover)"
                type="textarea"
                rows={5}
                placeholder="Enter the intro paragraph shown on the PDF cover page..."
                form={form} errors={errors} handleChange={handleChange}
              />
            </div>
            <hr className="divider" />
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--grey-600)', marginBottom: 12 }}>Preview</div>
            <div style={{ background: 'var(--grey-50)', borderRadius: 'var(--radius-md)', padding: '14px 16px', border: '1px solid var(--grey-100)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pink)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Additional Terms & Conditions</div>
              <div style={{ fontSize: 13, color: 'var(--grey-600)', whiteSpace: 'pre-line', lineHeight: 1.8 }}>{form.default_terms || 'No terms set yet.'}</div>
            </div>
          </>
        )}

        {activeTab === 'templates' && <TemplatesTab />}
        {activeTab === 'lead_sources' && <LeadSourcesTab />}
        {activeTab === 'event_types' && <EventTypesTab />}

        {activeTab !== 'templates' && activeTab !== 'lead_sources' && activeTab !== 'event_types' && (
          <div className="save-bar">
            <div className="save-hint">
              {saved
                ? <span style={{ color: 'var(--green)', fontWeight: 500 }}>✅ Settings saved successfully!</span>
                : <span>Fields marked <span style={{ color: 'var(--pink)' }}>*</span> are required</span>}
            </div>
            <button className="btn primary" onClick={handleSave} disabled={saving}>
              {saving ? '⏳ Saving...' : '💾 Save settings'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
