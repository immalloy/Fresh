import { createDesktopBridge } from "./bridge";

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export function initDesktopBridge(): void {
  if (typeof window === "undefined" || window.freshDesktop) {
    return;
  }

  const isTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  if (!isTauri) {
    return;
  }
  window.freshDesktop = createDesktopBridge();
}

