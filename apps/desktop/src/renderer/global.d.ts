import type { ApplePiApi } from "../shared/pi-api.js";

declare global {
  interface Window {
    applePi: ApplePiApi;
  }
}

export {};
