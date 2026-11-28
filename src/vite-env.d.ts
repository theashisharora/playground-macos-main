/// <reference types="vite/client" />

// This file is a module (it has an import), so augment the global interface.
declare global {
  interface ImportMetaEnv {
    /** Independent classic portfolio destination for small initial viewports. */
    readonly VITE_CLASSIC_PORTFOLIO_URL?: string;
    /** Public URL of the contact Worker. Unset => Messages runs in preview mode. */
    readonly VITE_CONTACT_ENDPOINT?: string;
    /** Public Cloudflare Turnstile site key (not a secret). */
    readonly VITE_TURNSTILE_SITE_KEY?: string;
  }
}

import type { AttributifyAttributes } from "unocss/dist/preset-attributify";

declare module "react" {
  /* eslint-disable-next-line @typescript-eslint/no-empty-interface */
  interface HTMLAttributes<T> extends AttributifyAttributes {}
}
