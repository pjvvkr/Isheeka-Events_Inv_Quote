// App shell: auth gate, session-timeout, navigation stack/router, sidebar.
// Ported from isheeka-erp-v22.html. Modules not yet ported render <ComingSoon/>;
// each is swapped for its real component as later checkpoints land.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './lib/supabase';
import { NAV, SESSION_TIMEOUT, SESSION_WARNING } from './lib/constants.js';
import { ToastHost } from './lib/toast.jsx';
import { LoginScreen } from './components/LoginScreen.jsx';
import { SessionWarning } from './components/SessionWarning.jsx';
import { NavBar } from './components/NavBar.jsx';
import { ComingSoon } from './components/ComingSoon.jsx';
import { Dashboard } from './modules/Dashboard.jsx';
import { ExpensesModule } from './modules/ExpensesModule.jsx';
import { VendorPaymentsModule } from './modules/VendorPaymentsModule.jsx';
import { VendorsModule } from './modules/VendorsModule.jsx';
import { ReportsModule } from './modules/ReportsModule.jsx';
import { RFQsModule } from './modules/RFQsModule.jsx';
import { ClientsModule } from './modules/ClientsModule.jsx';
import { InvoicesModule } from './modules/InvoicesModule.jsx';
import { SettingsModule } from './modules/SettingsModule.jsx';
import { LeadsModule } from './modules/LeadsModule.jsx';
import { QuotationsModule } from './modules/QuotationsModule.jsx';
import { EventsModule } from './modules/EventsModule.jsx';
import { UsersModule } from './modules/UsersModule.jsx';

const pageTitles = { dashboard: 'Dashboard', leads: 'Leads', clients: 'Clients', events: 'Events', quotations: 'Quotations', invoices: 'Invoices', vendors: 'Vendors', 'vendor-payments': 'Vendor Payments', expenses: 'Expenses', reports: 'Reports', users: 'Users', settings: 'Settings', 'owner-account': 'Owner Account' };

export default function Shell() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Global navigation history stack. Each entry: {page, opts?, label}. Top entry = current screen.
  const [navStack, setNavStack] = useState([{ page: 'dashboard', label: 'Dashboard' }]);
  const current = navStack[navStack.length - 1];
  const activePage = current.page;
  const navigate = useCallback((page, opts = {}) => {
    const o = opts || {};
    const rest = {}; ['eventId', 'leadId', 'invoiceId', 'quotId', 'clientId', 'vendorId', 'expenseId', 'rfqId', 'costingRfqId', 'prefill', 'mode', 'referenceEvent', 'referenceData'].forEach((k) => { if (o[k] !== undefined && o[k] !== null) rest[k] = o[k]; });
    const hasPayload = Object.keys(rest).length > 0;
    const label = o.label || pageTitles[page] || page;
    setNavStack((st) => {
      const top = st[st.length - 1];
      if (top && top.page === page && (top.label || '') === label && JSON.stringify(top.opts || {}) === JSON.stringify(rest)) return st;
      return [...st, { page, opts: hasPayload ? rest : undefined, label }];
    });
  }, []);
  const goBack = useCallback(() => { setNavStack((st) => (st.length > 1 ? st.slice(0, -1) : st)); }, []);
  const jumpTo = useCallback((i) => { setNavStack((st) => ((i >= 0 && i < st.length - 1) ? st.slice(0, i + 1) : st)); }, []);
  const resetTo = useCallback((page) => { setNavStack([{ page, label: pageTitles[page] || page }]); }, []);
  const [showWarning, setShowWarning] = useState(false);
  const lastActivity = useRef(Date.now());
  const warningTimer = useRef(null);
  const logoutTimer = useRef(null);

  const resetTimers = useCallback(() => {
    lastActivity.current = Date.now();
    setShowWarning(false);
    clearTimeout(warningTimer.current);
    clearTimeout(logoutTimer.current);
    warningTimer.current = setTimeout(() => setShowWarning(true), SESSION_WARNING);
    logoutTimer.current = setTimeout(() => handleLogout(), SESSION_TIMEOUT);
  }, []);

  const handleLogout = async () => {
    clearTimeout(warningTimer.current);
    clearTimeout(logoutTimer.current);
    await supabase.auth.signOut();
    setUser(null);
    setShowWarning(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user ?? null); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((e) => document.addEventListener(e, resetTimers));
    resetTimers();
    return () => { events.forEach((e) => document.removeEventListener(e, resetTimers)); clearTimeout(warningTimer.current); clearTimeout(logoutTimer.current); };
  }, [user, resetTimers]);

  const role = 'admin';

  if (loading) return <div className="loading"><div className="spinner"></div><div style={{ color: 'var(--grey-400)', fontSize: 14 }}>Loading Isheeka Events...</div></div>;
  if (!user) return (<><ToastHost /><LoginScreen onLogin={(u) => { setUser(u); resetTimers(); }} /></>);

  return (
    <div className="app-layout">
      <ToastHost />
      {showWarning && <SessionWarning onStay={resetTimers} onLogout={handleLogout} />}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">
            <div style={{ fontSize: 28 }}>🌸</div>
            <div className="brand-text">
              <div className="name">ISHEEKA EVENTS</div>
              <div className="tagline">Making Every Event Memorable</div>
            </div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((group, gi) => (
            <div key={gi} className="nav-section">
              {group.section && <div className="nav-section-title">{group.section}</div>}
              {group.items.filter((item) => item.roles.includes(role)).map((item) => (
                <button key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => resetTo(item.id)}>
                  <span className="nav-icon">{item.icon}</span>{item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{(user.email || 'U').charAt(0).toUpperCase()}</div>
            <div><div className="user-name">{user.email?.split('@')[0]}</div><div className="user-role">Admin</div></div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>🚪 Sign out</button>
        </div>
      </aside>
      <main className="main-content">
        <div className="page-header">
          <div>
            <div className="page-title">{pageTitles[activePage]}</div>
            <div className="page-subtitle">Isheeka Events ERP</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--grey-400)' }}>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)' }} title="Connected"></div>
          </div>
        </div>
        <div className="page-body">
          <NavBar stack={navStack} onBack={goBack} onJump={jumpTo} />
          {activePage === 'dashboard' ? <Dashboard user={user} onNavigate={navigate} />
            : activePage === 'leads' ? <LeadsModule nav={current.opts || null} onNavigate={navigate} onBack={goBack} />
            : activePage === 'events' ? <EventsModule nav={current.opts || null} onNavigate={navigate} onBack={goBack} />
            : activePage === 'expenses' ? <ExpensesModule onNavigate={navigate} />
              : activePage === 'vendor-payments' ? <VendorPaymentsModule onNavigate={navigate} />
                : activePage === 'vendors' ? <VendorsModule nav={current.opts || null} onNavigate={navigate} onBack={goBack} />
                  : activePage === 'reports' ? <ReportsModule onNavigate={navigate} />
                    : activePage === 'rfqs' ? <RFQsModule nav={current.opts || null} onNavigate={navigate} onBack={goBack} />
                      : activePage === 'clients' ? <ClientsModule nav={current.opts || null} onNavigate={navigate} onBack={goBack} />
                        : activePage === 'quotations' ? <QuotationsModule nav={current.opts || null} onNavigate={navigate} onBack={goBack} />
                        : activePage === 'invoices' ? <InvoicesModule nav={current.opts || null} onNavigate={navigate} onBack={goBack} />
                          : activePage === 'settings' ? <SettingsModule />
                            : activePage === 'users' ? <UsersModule />
                              : <ComingSoon page={activePage} />}
        </div>
      </main>
    </div>
  );
}
