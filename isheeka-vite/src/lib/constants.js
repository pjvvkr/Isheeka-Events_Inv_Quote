// Pure data constants ported verbatim from isheeka-erp-v22.html.
// No dependencies — safe to import anywhere. Names kept identical to the legacy
// single-file app so component ports can reference them unchanged.

// ── Session ───────────────────────────────────────────────────────────────────
export const SESSION_TIMEOUT = 30 * 60 * 1000;
export const SESSION_WARNING = 25 * 60 * 1000;

// ── Navigation ────────────────────────────────────────────────────────────────
export const NAV = [
  { section: null, items: [{ id: 'dashboard', label: 'Dashboard', icon: '🏠', roles: ['admin', 'manager', 'staff'] }] },
  { section: 'SALES', items: [
    { id: 'leads', label: 'Leads', icon: '🎯', roles: ['admin', 'manager', 'staff'] },
    { id: 'rfqs', label: 'Client RFQ', icon: '📝', roles: ['admin', 'manager', 'staff'] },
    { id: 'clients', label: 'Clients', icon: '👥', roles: ['admin', 'manager', 'staff'] },
  ] },
  { section: 'OPERATIONS', items: [
    { id: 'events', label: 'Events', icon: '🎪', roles: ['admin', 'manager', 'staff'] },
    { id: 'quotations', label: 'Quotations', icon: '📋', roles: ['admin', 'manager', 'staff'] },
    { id: 'invoices', label: 'Invoices', icon: '🧾', roles: ['admin', 'manager', 'staff'] },
  ] },
  { section: 'VENDORS', items: [
    { id: 'vendors', label: 'Vendors', icon: '🔧', roles: ['admin', 'manager', 'staff'] },
    { id: 'vendor-rfqs', label: 'Vendor RFQ', icon: '📨', roles: ['admin', 'manager', 'staff'] },
    { id: 'vendor-payments', label: 'Vendor Payments', icon: '💳', roles: ['admin', 'manager'] },
  ] },
  { section: 'FINANCE', items: [
    { id: 'expenses', label: 'Expenses', icon: '💰', roles: ['admin', 'manager'] },
    { id: 'reports', label: 'Reports', icon: '📊', roles: ['admin', 'manager'] },
  ] },
  { section: 'ADMIN', items: [
    { id: 'users', label: 'Users', icon: '👤', roles: ['admin'] },
    { id: 'settings', label: 'Settings', icon: '⚙️', roles: ['admin'] },
    { id: 'owner-account', label: 'Owner Account', icon: '💼', roles: ['admin'] },
  ] },
];

// ── Leads ─────────────────────────────────────────────────────────────────────
export const LEAD_STAGES = [
  'new', 'contacted', 'quote_generation_in_progress', 'quote_sent',
  'quote_revision_pending', 'revised_quote_sent', 'quote_confirmed', 'event_triggered',
];
export const LEAD_STAGE_LABELS = {
  new: 'New', contacted: 'Contacted',
  quote_generation_in_progress: 'Quote In Progress',
  quote_sent: 'Quote Sent',
  quote_revision_pending: 'Revision Pending',
  revised_quote_sent: 'Revised Quote Sent',
  quote_confirmed: 'Quote Confirmed',
  event_triggered: 'Event Triggered',
  completed: 'Completed',
};
export const LEAD_STAGE_COLORS = {
  new: { bg: '#E6F1FB', color: '#185FA5' },
  contacted: { bg: '#FFF3E0', color: '#E65100' },
  quote_generation_in_progress: { bg: '#F3E5F5', color: '#6A1B9A' },
  quote_sent: { bg: '#E1F5EE', color: '#0F6E56' },
  quote_revision_pending: { bg: '#FCEBEB', color: '#A32D2D' },
  revised_quote_sent: { bg: '#FFF8E1', color: '#F57F17' },
  quote_confirmed: { bg: '#FAEEDA', color: '#854F0B' },
  event_triggered: { bg: '#E1F5EE', color: '#0F6E56' },
  completed: { bg: '#E1F5EE', color: '#0F6E56' },
  lost: { bg: '#FCEBEB', color: '#A32D2D' },
};
export const LEAD_LOSS_REASONS = [
  { value: 'price_too_high', label: 'Price too high' },
  { value: 'went_with_competitor', label: 'Went with competitor' },
  { value: 'event_cancelled', label: 'Event cancelled' },
  { value: 'event_postponed', label: 'Event postponed' },
  { value: 'no_response', label: 'No response' },
  { value: 'out_of_service_area', label: 'Out of service area' },
  { value: 'other', label: 'Other' },
];
// Reasons for closing a quote as "not proceeding", split by who walked away.
export const REJECT_REASONS = {
  client: [{ value: 'price_too_high', label: 'Price too high' }, { value: 'went_with_competitor', label: 'Went with competitor' }, { value: 'event_postponed', label: 'Event postponed' }, { value: 'no_response', label: 'No response / went quiet' }, { value: 'changed_plans', label: 'Changed plans' }, { value: 'other', label: 'Other' }],
  us: [{ value: 'scheduling_conflict', label: 'Scheduling conflict' }, { value: 'capacity', label: 'No capacity / overbooked' }, { value: 'out_of_service_area', label: 'Out of service area' }, { value: 'other', label: 'Other' }],
};
export const LEAD_SOURCES_DEFAULT = [
  { value: 'phone', label: 'Phone call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'website', label: 'Website' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'referral', label: 'Referral' },
];

// ── Event types ───────────────────────────────────────────────────────────────
export const EVENT_TYPES_DEFAULT = [
  { value: 'wedding', label: 'Wedding' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
  { value: 'other', label: 'Other' },
];
export const EVENT_TYPES = ['Wedding', 'Corporate', 'Birthday', 'Anniversary', 'Other'];

// ── Follow-up urgency ─────────────────────────────────────────────────────────
export const URGENCY_COLORS = {
  overdue: { dot: '#A32D2D', label: 'Overdue', bg: '#FCEBEB', color: '#A32D2D' },
  today: { dot: '#c87d2a', label: 'Today', bg: '#FAEEDA', color: '#854F0B' },
  week: { dot: '#0F6E56', label: 'This week', bg: '#E1F5EE', color: '#0F6E56' },
  future: { dot: '#185FA5', label: 'Upcoming', bg: '#E6F1FB', color: '#185FA5' },
  none: { dot: '#ccc', label: 'No date', bg: 'var(--grey-100)', color: 'var(--grey-400)' },
};

// ── Events ────────────────────────────────────────────────────────────────────
export const EVENT_STATUS_ORDER = ['in_progress', 'confirmed', 'planning', 'completed', 'cancelled'];
export const EVENT_STATUS_LABELS = { in_progress: 'In Progress', confirmed: 'Confirmed', planning: 'Planning', completed: 'Completed', cancelled: 'Cancelled' };
export const EVENT_STATUS_COLORS = {
  planning: { bg: '#F1ECE4', color: '#6B6660', dot: '#9A938A' },
  confirmed: { bg: '#E6F1FB', color: '#185FA5', dot: '#185FA5' },
  in_progress: { bg: '#FAEEDA', color: '#854F0B', dot: '#c87d2a' },
  completed: { bg: '#E1F5EE', color: '#0F6E56', dot: '#0F6E56' },
  cancelled: { bg: '#FCEBEB', color: '#A32D2D', dot: '#A32D2D' },
};
export const EVENT_STAGE_COLORS = {
  quote_approved: { bg: '#E6F1FB', color: '#185FA5' },
  invoice_issued: { bg: '#FAEEDA', color: '#854F0B' },
  partly_paid: { bg: '#FAEEDA', color: '#854F0B' },
  paid: { bg: '#E1F5EE', color: '#0F6E56' },
};

// ── Invoices ──────────────────────────────────────────────────────────────────
export const INVOICE_STATUS_COLORS = {
  draft: { bg: '#F1ECE4', color: '#6B6660', dot: '#9A938A' },
  sent: { bg: '#E6F1FB', color: '#185FA5', dot: '#185FA5' },
  partially_paid: { bg: '#FAEEDA', color: '#854F0B', dot: '#c87d2a' },
  paid: { bg: '#E1F5EE', color: '#0F6E56', dot: '#0F6E56' },
  overdue: { bg: '#FCEBEB', color: '#A32D2D', dot: '#A32D2D' },
  cancelled: { bg: '#F1ECE4', color: '#9A938A', dot: '#CFC6BA' },
};
export const INVOICE_STATUS_LABELS = { draft: 'Draft', sent: 'Sent', partially_paid: 'Partly paid', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled' };

// ── Quotations ────────────────────────────────────────────────────────────────
export const QUOT_STATUS_COLORS = {
  draft: { bg: 'var(--grey-100)', color: 'var(--grey-400)' },
  sent: { bg: 'var(--blue-light)', color: 'var(--blue)' },
  approved: { bg: 'var(--green-light)', color: 'var(--green)' },
  revision_requested: { bg: '#FCEBEB', color: '#A32D2D' },
  revised: { bg: '#FFF8E1', color: '#F57F17' },
  superseded: { bg: 'var(--grey-100)', color: 'var(--grey-400)' },
  rejected: { bg: '#FCEBEB', color: '#A32D2D' },
  expired: { bg: 'var(--grey-100)', color: 'var(--grey-400)' },
  converted: { bg: 'var(--pink-light)', color: 'var(--pink)' },
  invoiced: { bg: 'var(--green-light)', color: 'var(--green)' },
};
export const QUOT_STATUS_LABELS = {
  draft: 'Draft', sent: 'Sent', approved: 'Approved',
  revision_requested: 'Revision Requested', revised: 'Revised',
  superseded: 'Superseded', rejected: 'Rejected',
  expired: 'Expired', converted: 'Converted', invoiced: 'Invoiced',
};

// ── RFQ ───────────────────────────────────────────────────────────────────────
export const RFQ_STATUS = {
  draft: { l: 'Draft', bg: 'var(--grey-100)', c: 'var(--grey-400)' },
  sent: { l: 'Sent', bg: 'var(--blue-light)', c: 'var(--blue)' },
  in_progress: { l: 'In progress', bg: '#FAEEDA', c: '#854F0B' },
  submitted: { l: 'Submitted', bg: '#FAEEDA', c: '#854F0B' },
  changes_requested: { l: 'Changes requested', bg: '#FCEBEB', c: '#A32D2D' },
  approved: { l: 'Approved', bg: 'var(--green-light)', c: 'var(--green)' },
  converted: { l: 'Converted', bg: 'var(--pink-light)', c: 'var(--pink)' },
  withdrawn: { l: 'Withdrawn', bg: 'var(--grey-100)', c: 'var(--grey-400)' },
  expired: { l: 'Expired', bg: 'var(--grey-100)', c: 'var(--grey-400)' },
};
export const RFQ_ACTION_LABEL = { created: 'Created', sent: 'Sent', otp_sent: 'OTP emailed', otp_verified: 'Client verified (email)', pin_verified: 'Client verified (PIN)', saved: 'Client saved a draft', submitted: 'Client submitted', changes_requested: 'Changes requested', approved: 'Approved → quote', converted: 'Converted' };

// ── Vendors / Expenses ────────────────────────────────────────────────────────
export const VENDOR_CATS = [['caterer', 'Caterer'], ['decorator', 'Decorator'], ['photographer', 'Photographer'], ['sound_lighting', 'Sound & lighting'], ['venue', 'Venue'], ['transport', 'Transport'], ['makeup', 'Makeup'], ['entertainment', 'Entertainment'], ['other', 'Other']];
export const VENDOR_MODES = [['upi', 'UPI'], ['neft', 'Bank / NEFT'], ['cash', 'Cash'], ['cheque', 'Cheque']];
export const EXPENSE_CATS = [['marketing', 'Marketing'], ['operations', 'Operations'], ['travel', 'Travel'], ['staff', 'Staff'], ['event_incidentals', 'Event incidentals'], ['professional', 'Professional'], ['banking', 'Banking'], ['miscellaneous', 'Miscellaneous']];

// ── Budget ranges ─────────────────────────────────────────────────────────────
export const BUDGET_RANGES = [
  { label: 'All budgets', value: '' },
  { label: 'Under ₹1L', value: '0-100000' },
  { label: '₹1L – ₹5L', value: '100000-500000' },
  { label: '₹5L – ₹10L', value: '500000-1000000' },
  { label: '₹10L – ₹25L', value: '1000000-2500000' },
  { label: 'Above ₹25L', value: '2500000-999999999' },
];
