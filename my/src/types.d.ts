import type { ElsaadApi } from './shared/types.js';

declare global {
  interface Window {
    "elsaad": ElsaadApi;
  }
}

export {};
