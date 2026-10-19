/// <reference types="vite/client" />

/** Development-only handle on the store (`main.tsx`), for pushing a fixture without a password. */
interface Window {
  __dashboard?: unknown;
}
