import type { HtmlAssets } from "@havelaer/vite-plugin-ssr";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import App from "./App.tsx";
import Document from "./Document.tsx";
import "./index.css";

declare global {
  interface Window {
    __ssr_assets: HtmlAssets;
  }
}

hydrateRoot(
  document,
  <StrictMode>
    <Document assets={window.__ssr_assets}>
      <App />
    </Document>
  </StrictMode>,
);
