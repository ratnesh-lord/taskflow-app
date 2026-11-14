/**
 * Android/iOS only (the web build uses polyfills.web.ts, which is empty).
 *
 * supabase-js expects a browser-like environment: a complete URL class and
 * Web Crypto for the sign-in code exchange (PKCE with SHA-256). React Native
 * provides neither in full, so the missing pieces are filled in from Expo's
 * native crypto module.
 */
import 'react-native-url-polyfill/auto';

import * as Crypto from 'expo-crypto';

type CryptoLike = {
  getRandomValues?: unknown;
  randomUUID?: unknown;
  subtle?: unknown;
};

const scope = globalThis as unknown as { crypto?: CryptoLike };

try {
  const target: CryptoLike = scope.crypto ?? {};
  if (typeof target.getRandomValues !== 'function') {
    target.getRandomValues = Crypto.getRandomValues;
  }
  if (typeof target.randomUUID !== 'function') {
    target.randomUUID = Crypto.randomUUID;
  }
  if (target.subtle == null) {
    target.subtle = {
      digest: (algorithm: string | { name: string }, data: BufferSource) =>
        Crypto.digest(
          (typeof algorithm === 'string' ? algorithm : algorithm.name) as Crypto.CryptoDigestAlgorithm,
          data,
        ),
    };
  }
  if (scope.crypto == null) {
    scope.crypto = target;
  }
} catch {
  // If the runtime refuses the additions, supabase-js falls back to a plain
  // code challenge, which still works.
}
