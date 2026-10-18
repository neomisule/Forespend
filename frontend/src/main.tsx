import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Fonts are bundled with the app (no request to an outside font server).
import "@fontsource-variable/fredoka";
import "@fontsource-variable/plus-jakarta-sans";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
