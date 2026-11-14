/**
 * Reads the values Supabase attaches to the address it sends the user back to
 * after Google sign-in, an email confirmation or a password-reset link.
 * They can arrive in the query (?code=...) or in the fragment (#access_token=...).
 */
export type AuthUrlParams = {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
  type?: string;
  error?: string;
  errorDescription?: string;
};

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

export function parseAuthUrl(url: string): AuthUrlParams {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const fragment = hashAt >= 0 ? url.slice(hashAt + 1) : '';
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '';

  const values = new Map<string, string>();
  for (const section of [query, fragment]) {
    for (const pair of section.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = decode(eq >= 0 ? pair.slice(0, eq) : pair);
      const value = decode(eq >= 0 ? pair.slice(eq + 1) : '');
      if (key && !values.has(key)) values.set(key, value);
    }
  }

  const pick = (key: string) => {
    const value = values.get(key);
    return value ? value : undefined;
  };

  return {
    code: pick('code'),
    accessToken: pick('access_token'),
    refreshToken: pick('refresh_token'),
    type: pick('type'),
    error: pick('error') ?? pick('error_code'),
    errorDescription: pick('error_description'),
  };
}
