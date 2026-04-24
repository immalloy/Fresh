import type { DesktopBridge } from "../services/fresh";

declare global {
  interface Window {
    freshDesktop?: DesktopBridge;
  }
}

export {};

