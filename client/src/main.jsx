import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Which build is actually running. A stale frontend looks exactly like a broken
// feature from the outside, so make the answer one console line away.
// eslint-disable-next-line no-undef
console.info("[whitebored] build", typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev");
