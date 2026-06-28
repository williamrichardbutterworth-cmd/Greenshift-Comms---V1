// Minimal ambient types for dompurify 2.x. The installed build ships no bundled
// `.d.ts` and we intentionally don't add `@types/dompurify` (it would clash with this
// shim). We only use the browser `sanitize` entry point.
declare module 'dompurify' {
  interface SanitizeConfig {
    ADD_ATTR?: string[];
    ADD_TAGS?: string[];
    FORBID_ATTR?: string[];
    FORBID_TAGS?: string[];
    ALLOWED_TAGS?: string[];
    ALLOWED_ATTR?: string[];
    ALLOWED_URI_REGEXP?: RegExp;
    USE_PROFILES?: { html?: boolean; svg?: boolean; svgFilters?: boolean; mathMl?: boolean };
    [key: string]: unknown;
  }
  interface DOMPurifyI {
    sanitize(dirty: string, config?: SanitizeConfig): string;
    addHook(entry: string, cb: (...args: unknown[]) => unknown): void;
    isSupported: boolean;
  }
  const DOMPurify: DOMPurifyI;
  export default DOMPurify;
}
