import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Component CSS-module styles are pre-compiled into this file in the published
// package; the JS bundle does not auto-inject them, so the consumer imports it.
// (The package `exports` map does not expose this subpath, so we use a file path.)
import "../node_modules/@a2ui/react/v0_9/index.css";
import { injectStyles } from "@a2ui/react/styles";
import "./host-theme.css";
import { App } from "./App";

// Inject the structural (.a2ui-surface) layout styles into <head>.
injectStyles();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
