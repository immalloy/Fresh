import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { initDesktopBridge } from "./src/desktop/init";
import "./styles/index.css";

initDesktopBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
