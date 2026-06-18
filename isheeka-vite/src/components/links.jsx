// Click-through name links to client / vendor detail pages (ported verbatim).
export function ClientLink({ clientId, name, onNavigate, style, title, children }) {
  const label = children != null ? children : name;
  if (!clientId || !onNavigate) return <span style={style}>{label}</span>;
  return <a onClick={(e) => { e.stopPropagation && e.stopPropagation(); onNavigate('clients', { clientId, label: (typeof name === 'string' && name) || 'Client' }); }}
    style={{ color: 'var(--pink)', cursor: 'pointer', ...(style || {}) }} title={title || 'Open client'}>{label}</a>;
}

export function VendorLink({ vendorId, name, onNavigate, style, title, children }) {
  const label = children != null ? children : name;
  if (!vendorId || !onNavigate) return <span style={style}>{label}</span>;
  return <a onClick={(e) => { e.stopPropagation && e.stopPropagation(); onNavigate('vendors', { vendorId, label: (typeof name === 'string' && name) || 'Vendor' }); }}
    style={{ color: 'var(--pink)', cursor: 'pointer', ...(style || {}) }} title={title || 'Open vendor'}>{label}</a>;
}
