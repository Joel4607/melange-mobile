import type { TokenStorage } from '@convex-dev/auth/react';

export const authStorage: TokenStorage = {
  getItem: (key) => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
  setItem: (key, value) => { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); },
  removeItem: (key) => { if (typeof window !== 'undefined') window.localStorage.removeItem(key); },
};
