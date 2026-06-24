// Reference-number counters (ported from isheeka-erp-v22.html).
// Each calls the atomic `next_counter(p_type, p_year, p_seed)` Postgres RPC so
// numbers never collide. Seeds/prefixes/padding match the live app exactly.
import { supabase } from './supabase';
import { notify } from './toast.jsx';

export async function getNextQuotRef() {
  const year = new Date().getFullYear().toString().slice(-2);
  const { data, error } = await supabase.rpc('next_counter', { p_type: 'quotation', p_year: year, p_seed: 1111 });
  if (error || data == null) { notify("Couldn't generate a quotation number. Please try again.", 'error'); throw error || new Error('counter failed'); }
  return 'Q-' + year + '-' + data;
}

export async function getNextLeadRef() {
  const year = new Date().getFullYear().toString().slice(-2);
  const { data, error } = await supabase.rpc('next_counter', { p_type: 'lead', p_year: year, p_seed: 1111 });
  if (error || data == null) { notify("Couldn't generate a lead number. Please try again.", 'error'); throw error || new Error('counter failed'); }
  return 'L-' + year + '-' + data;
}

export async function getNextClientRef() {
  const { data, error } = await supabase.rpc('next_counter', { p_type: 'client', p_year: '0', p_seed: 111111 });
  if (error || data == null) { notify("Couldn't generate a client number. Please try again.", 'error'); throw error || new Error('counter failed'); }
  return 'CL-' + String(data).padStart(6, '0');
}

export async function getNextEventRef() {
  const year = new Date().getFullYear().toString().slice(-2);
  const { data, error } = await supabase.rpc('next_counter', { p_type: 'event', p_year: year, p_seed: 1 });
  if (error || data == null) { notify("Couldn't generate an event number. Please try again.", 'error'); throw error || new Error('counter failed'); }
  return 'E-' + year + '-' + String(data).padStart(4, '0');
}

export async function getNextInvoiceRef() {
  const year = new Date().getFullYear().toString().slice(-2);
  const { data, error } = await supabase.rpc('next_counter', { p_type: 'invoice', p_year: year, p_seed: 1111 });
  if (error || data == null) { notify("Couldn't generate an invoice number. Please try again.", 'error'); throw error || new Error('counter failed'); }
  return 'I-' + year + '-' + String(data).padStart(4, '0');
}

export async function getNextRfqRef() {
  const year = new Date().getFullYear().toString().slice(-2);
  const { data, error } = await supabase.rpc('next_counter', { p_type: 'rfq', p_year: year, p_seed: 1111 });
  if (error || data == null) { notify("Couldn't generate an RFQ number. Please try again.", 'error'); throw error || new Error('counter failed'); }
  return 'RFQ-' + year + '-' + data;
}

export async function getNextExpenseRef() {
  const year = new Date().getFullYear().toString().slice(-2);
  const { data, error } = await supabase.rpc('next_counter', { p_type: 'expense', p_year: year, p_seed: 1111 });
  if (error || data == null) { notify("Couldn't generate an expense number. Please try again.", 'error'); throw error || new Error('counter failed'); }
  return 'Ex-' + year + '-' + data;
}

// Owner-ledger refs: funding → Fn, reimbursement → Rb, settlement → St.
const OWNER_PREFIX = { funding: 'Fn', reimbursement: 'Rb', settlement: 'St' };
export async function getNextOwnerRef(entryType) {
  const year = new Date().getFullYear().toString().slice(-2);
  const { data, error } = await supabase.rpc('next_counter', { p_type: 'owner_' + entryType, p_year: year, p_seed: 1111 });
  if (error || data == null) { notify("Couldn't generate a reference number. Please try again.", 'error'); throw error || new Error('counter failed'); }
  return (OWNER_PREFIX[entryType] || 'Ol') + '-' + year + '-' + data;
}
