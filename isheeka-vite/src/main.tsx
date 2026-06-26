import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import App from "./App";

// PWA auto-update: when a newly-deployed service worker takes control (an actual
// update, not the first install), flag it so the app can confirm after the reload.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) { try { sessionStorage.setItem("isheeka-updated", "1"); } catch (e) { /* noop */ } }
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
