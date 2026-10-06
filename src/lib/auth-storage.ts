import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from '@convex-dev/auth/react';

export const authStorage: TokenStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};
