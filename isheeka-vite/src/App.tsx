// App entry — mounts the ported shell. `_portcheck` keeps the production build
// bundling/verifying ported lib modules that the shell doesn't yet consume
// (removed once every module is wired into real UI).
import "./lib/_portcheck";
import Shell from "./Shell.jsx";

export default function App() {
  return <Shell />;
}
