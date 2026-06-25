// Configurable reference data loaders + caches (ported from isheeka-erp-v22.html).
// Lead sources and event types are admin-editable tables that fall back to the
// built-in defaults. Caches are module-level singletons (load once per session).
import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { LEAD_SOURCES_DEFAULT, EVENT_TYPES_DEFAULT } from './constants.js';
import { registerEventTypeLabels } from './format.js';

// ── Lead sources ──────────────────────────────────────────────────────────────
let _leadSourcesCache = null;
// Settings edits clear these so the next fetch re-reads the table (replaces the
// single-file app's direct `_leadSourcesCache = null` / `_eventTypesCache = null`).
export function clearLeadSourcesCache() { _leadSourcesCache = null; }
export async function fetchLeadSources() {
  if (_leadSourcesCache) return _leadSourcesCache;
  try {
    const { data } = await supabase.from('lead_sources').select('*').eq('is_active', true).order('label');
    if (data && data.length > 0) {
      _leadSourcesCache = data.map((s) => ({ value: s.value, label: s.label }));
      return _leadSourcesCache;
    }
  } catch (e) { /* fall through to defaults */ }
  return LEAD_SOURCES_DEFAULT;
}

// ── Event types ───────────────────────────────────────────────────────────────
let _eventTypesCache = null;
export function clearEventTypesCache() { _eventTypesCache = null; }
export async function fetchEventTypes() {
  if (_eventTypesCache) return _eventTypesCache;
  try {
    const { data } = await supabase.from('event_types').select('*').eq('is_active', true).order('sort_order');
    if (data && data.length > 0) {
      _eventTypesCache = data.map((t) => ({ value: t.value, label: t.label }));
      // Register custom labels so eventTypeLabel() renders them (replaces the old
      // shared mutable _eventTypeLabelMap global from the single-file app).
      registerEventTypeLabels(data);
      return _eventTypesCache;
    }
  } catch (e) { /* fall through to defaults */ }
  return EVENT_TYPES_DEFAULT;
}

// Hook: configurable event types as [{value,label}] (falls back to defaults).
export function useEventTypes() {
  const [t, setT] = useState(EVENT_TYPES_DEFAULT);
  useEffect(() => { fetchEventTypes().then(setT); }, []);
  return t;
}
