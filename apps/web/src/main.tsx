import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App.js";
import { bootstrapThemeRuntime } from "./styles/theme-runtime.js";
import "./styles/fonts.css";
import "./styles/global.css";

bootstrapThemeRuntime();

const container = document.getElementById("root");
if (!container) {
  throw new Error("apps/web: #root element is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
