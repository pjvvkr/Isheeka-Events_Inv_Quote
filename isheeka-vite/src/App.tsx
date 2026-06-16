// Placeholder shell for the graduated build. The real app is ported here
// module-by-module from isheeka-erp-v22.html (behavior-preserving), then we
// switch over only once it matches the live app screen-for-screen.
export default function App() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        background: "#FAF7F3",
        color: "#2A2723",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#A01044" }}>ISHEEKA EVENTS — ERP</div>
        <div style={{ fontSize: 13, color: "#9A938A", marginTop: 6 }}>
          Vite + React + TypeScript build · scaffolding in progress
        </div>
      </div>
    </div>
  );
}
