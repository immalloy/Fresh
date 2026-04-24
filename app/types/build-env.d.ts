declare const __FRESH_VERSION__: string;
declare const __FRESH_CHANNEL__: string;

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  readonly VITE_BUILD_CHANNEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
