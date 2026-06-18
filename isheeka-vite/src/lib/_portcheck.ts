// TEMPORARY (port phase only): side-effect imports of ported-but-not-yet-rendered
// lib modules, so `vite build` parses them, resolves their import graph, and bundles
// them — surfacing any breakage before the real UI consumes them. tsc already
// type-checks every file under src/; this just extends the same guarantee to the
// production bundler. Deleted once the modules are wired into real components.
import './toast.jsx';
import './data.js';
import './session.js';
import './refs.js';
import './rfq.js';
import './money.js';
import './share.js';
import '../components/fields.jsx';
import '../components/links.jsx';
import '../components/ItemEntry.jsx';
import '../components/QuoteWizard.jsx';

export {};
