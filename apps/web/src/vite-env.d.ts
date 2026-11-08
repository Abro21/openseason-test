/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL?: string;
  /** 'browser' runs the whole backend inside the tab (PGlite) instead of calling the gateway. */
  readonly VITE_SANDBOX?: string;
}
