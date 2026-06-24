// Module access model — the single source of truth for who can see/open which module.
// Used by the Shell (sidebar filter + route gate) and the Settings → Access control tab.
// A future DB-side RLS lockdown should read the same users.module_access map.
//
// Rules:
//  • Admins and Owners always have full access (can't be locked out).
//  • A user with no profile row defaults to full access (avoids accidental lockout).
//  • Managers/Staff get the grantable modules per their role preset, overridden by their
//    explicit module_access map.
//  • dashboard is always allowed; users/settings are admin-only; owner-account is owners-only
//    (none of these three are grantable via toggles).

export const MODULE_SECTIONS = [
  { section: 'SALES', items: [['leads', 'Leads'], ['rfqs', 'Client RFQ'], ['clients', 'Clients']] },
  { section: 'OPERATIONS', items: [['events', 'Events'], ['quotations', 'Quotations'], ['invoices', 'Invoices']] },
  { section: 'VENDORS', items: [['vendors', 'Vendors'], ['vendor-rfqs', 'Vendor RFQ'], ['vendor-payments', 'Vendor Payments']] },
  { section: 'FINANCE', items: [['expenses', 'Expenses'], ['reports', 'Reports']] },
];
export const GRANTABLE = MODULE_SECTIONS.flatMap((s) => s.items.map((i) => i[0]));
const ADMIN_ONLY = ['users', 'settings'];   // owner-account handled separately (owners only)

export const ROLE_DEFAULTS = {
  admin: GRANTABLE.slice(),
  manager: ['leads', 'rfqs', 'clients', 'events', 'quotations', 'invoices', 'vendors', 'vendor-rfqs', 'vendor-payments', 'expenses', 'reports'],
  staff: ['leads', 'rfqs', 'clients', 'events', 'quotations', 'vendors', 'vendor-rfqs'],
};

// A full {moduleId: bool} map for a role (used as the preset / fallback).
export function defaultAccessForRole(role) {
  const set = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.staff;
  const m = {}; GRANTABLE.forEach((id) => { m[id] = set.includes(id); });
  return m;
}

const FULL = () => new Set(['dashboard', ...GRANTABLE, ...ADMIN_ONLY, 'owner-account']);

// Set of module ids the profile may access. profile = users row (role, is_owner, module_access) or null.
export function effectiveModules(profile) {
  if (!profile) return FULL();                                  // no profile → full (no lockout)
  const role = profile.role || 'staff';
  if (role === 'admin' || profile.is_owner) return FULL();
  const ma = (profile.module_access && typeof profile.module_access === 'object') ? profile.module_access : defaultAccessForRole(role);
  const allowed = new Set(['dashboard']);
  GRANTABLE.forEach((id) => { if (ma[id]) allowed.add(id); });
  return allowed;                                               // managers/staff: no users/settings/owner-account
}
