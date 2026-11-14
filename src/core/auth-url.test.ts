import { parseAuthUrl } from './auth-url';

describe('parseAuthUrl', () => {
  it('reads the code from an app link', () => {
    expect(parseAuthUrl('taskflow://auth-callback?code=abc-123')).toEqual({ code: 'abc-123' });
  });

  it('reads the code from a web address', () => {
    expect(parseAuthUrl('https://taskflow.example/auth-callback?code=xyz&state=1').code).toBe('xyz');
  });

  it('reads tokens from the fragment', () => {
    const parsed = parseAuthUrl('taskflow://auth-callback#access_token=AAA&refresh_token=RRR&type=recovery');
    expect(parsed).toEqual({ accessToken: 'AAA', refreshToken: 'RRR', type: 'recovery' });
  });

  it('reads an error and decodes its description', () => {
    const parsed = parseAuthUrl(
      'taskflow://auth-callback?error=access_denied&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(parsed.error).toBe('access_denied');
    expect(parsed.errorDescription).toBe('Email link is invalid or has expired');
  });

  it('reads an error that arrives in the fragment', () => {
    const parsed = parseAuthUrl('https://taskflow.example/auth-callback#error=server_error&error_description=Boom%21');
    expect(parsed.error).toBe('server_error');
    expect(parsed.errorDescription).toBe('Boom!');
  });

  it('prefers the query over the fragment when both carry a key', () => {
    expect(parseAuthUrl('taskflow://auth-callback?code=first#code=second').code).toBe('first');
  });

  it('returns nothing for an address without sign-in values', () => {
    expect(parseAuthUrl('taskflow://auth-callback')).toEqual({});
    expect(parseAuthUrl('taskflow://auth-callback?code=')).toEqual({});
  });

  it('survives malformed percent-encoding', () => {
    expect(parseAuthUrl('taskflow://auth-callback?error_description=100%').errorDescription).toBe('100%');
  });
});
