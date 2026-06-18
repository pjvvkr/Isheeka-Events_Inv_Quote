// Placeholder for a module not yet ported into the Vite build (ported verbatim).
export function ComingSoon({ page }) {
  const icons = { leads: '🎯', clients: '👥', events: '🎪', quotations: '📋', invoices: '🧾', vendors: '🔧', 'vendor-payments': '💳', expenses: '💰', reports: '📊', users: '👤', 'owner-account': '💼' };
  return (
    <div className="coming-soon">
      <div className="cs-icon">{icons[page] || '🚧'}</div>
      <h2>{page.charAt(0).toUpperCase() + page.slice(1).replace('-', ' ')} module</h2>
      <p>This module is being built. Check back soon!</p>
    </div>
  );
}
