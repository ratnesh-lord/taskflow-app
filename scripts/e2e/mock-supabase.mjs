// A stand-in for the two Supabase services the app talks to, for the web end-to-end check.
//
//   /auth/v1/*   a fake sign-in service: any email works with the password "correct-password"
//                (until it is changed). Password reset follows Supabase's PKCE flow: the
//                "email" is kept in memory and read back through /auth/v1/test/mailbox; each
//                link works once, a new request cancels the old link, and a used link comes
//                back with the error after the # (as Supabase does when it can no longer
//                tell which flow the link belonged to).
//   /rest/v1/*   forwards each call to a REAL Postgres database that has the project's
//                migrations applied, as the signed-in user, so row-level security and the
//                sync functions run exactly as they would on Supabase
//
// Only for tests on this machine. It checks no signatures and must never be exposed.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

const DB = process.env.E2E_DB;
const PORT = Number(process.env.E2E_API_PORT ?? 54400);
const PASSWORD = 'correct-password';
const passwords = new Map(); // user id -> password changed through a reset
const recoveries = new Map(); // one-time email token -> { email, challenge, redirectTo }
const codes = new Map(); // auth code -> { email, challenge }
const mailbox = new Map(); // email -> the newest reset link sent
const randomToken = () => randomBytes(16).toString('hex');
if (!DB) throw new Error('E2E_DB is required');

function sql(text) {
  return execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qAt', '-d', DB, '-c', text], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
function literal(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return quote(value);
  return `${quote(JSON.stringify(value))}::jsonb`;
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function accessToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 };
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.not-a-real-signature`;
}
function subjectOf(req) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1].split('.')[1], 'base64url').toString()).sub ?? null;
  } catch {
    return null;
  }
}

function findUser(where) {
  const row = sql(`select id || '|' || email || '|' || coalesce(raw_user_meta_data ->> 'full_name', '') from auth.users where ${where}`);
  if (!row) return null;
  const [id, email, name] = row.split('|');
  return { id, email, name };
}
function userJson(user) {
  const at = new Date().toISOString();
  return {
    id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email,
    email_confirmed_at: at, confirmed_at: at, last_sign_in_at: at, created_at: at, updated_at: at,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: user.name ?? '' }, identities: [],
  };
}
function sessionJson(user) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: accessToken(user), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
    refresh_token: `refresh-${user.id}`, user: userJson(user),
  };
}

function asUser(sub, statement) {
  const who = sub
    ? `set role authenticated; set request.jwt.claim.sub = ${quote(sub)};`
    : `set role anon; set request.jwt.claim.sub = '';`;
  return sql(`${who} ${statement}`);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '600',
};
function send(res, status, body) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(text);
}
const authError = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return send(res, 400, { message: 'invalid JSON' });
    }
    console.log(`${req.method} ${url.pathname}${url.search}`);

    try {
      if (req.method === 'OPTIONS') return send(res, 204);

      // ---- sign-in service -------------------------------------------------
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        const user = findUser(`lower(email) = lower(${quote(body.email ?? '')})`);
        if (!user || body.password !== (passwords.get(user.id) ?? PASSWORD)) {
          return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
        }
        return send(res, 200, sessionJson(user));
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        const id = String(body.refresh_token ?? '').replace(/^refresh-/, '');
        const user = /^[0-9a-f-]{36}$/.test(id) ? findUser(`id = ${quote(id)}`) : null;
        if (!user) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token');
        return send(res, 200, sessionJson(user));
      }
      if (url.pathname === '/auth/v1/signup') {
        if (findUser(`lower(email) = lower(${quote(body.email ?? '')})`)) {
          return authError(res, 422, 'user_already_exists', 'User already registered');
        }
        if (String(body.password ?? '').length < 8) {
          return authError(res, 422, 'weak_password', 'Password should be at least 8 characters');
        }
        const id = sql(`select test.new_user(${quote(body.email)}, ${literal(body.data?.full_name ?? null)})`);
        passwords.set(id, String(body.password));
        return send(res, 200, sessionJson(findUser(`id = ${quote(id)}`)));
      }
      if (url.pathname === '/auth/v1/recover' && req.method === 'POST') {
        const email = String(body.email ?? '').toLowerCase();
        if (findUser(`lower(email) = ${quote(email)}`)) {
          for (const [token, r] of recoveries) if (r.email === email) recoveries.delete(token); // older links stop working
          const token = randomToken();
          const redirectTo = url.searchParams.get('redirect_to') ?? '';
          recoveries.set(token, { email, challenge: body.code_challenge ?? null, redirectTo });
          mailbox.set(email, `http://${req.headers.host}/auth/v1/verify?token=${token}&type=recovery&redirect_to=${encodeURIComponent(redirectTo)}`);
        }
        return send(res, 200, {});
      }
      if (url.pathname === '/auth/v1/test/mailbox') {
        const link = mailbox.get(String(url.searchParams.get('email') ?? '').toLowerCase());
        return link ? send(res, 200, { link }) : send(res, 404, { message: 'no email' });
      }
      if (url.pathname === '/auth/v1/verify' && req.method === 'GET') {
        const token = url.searchParams.get('token') ?? '';
        const redirectTo = url.searchParams.get('redirect_to') ?? '';
        const r = recoveries.get(token);
        if (!r) {
          const reason = 'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
          res.writeHead(303, { Location: `${redirectTo}#${reason}` });
          return res.end();
        }
        recoveries.delete(token);
        const code = randomToken();
        codes.set(code, { email: r.email, challenge: r.challenge });
        res.writeHead(303, { Location: `${r.redirectTo}?code=${code}` });
        return res.end();
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
        const c = codes.get(String(body.auth_code ?? ''));
        if (!c) return authError(res, 404, 'flow_state_not_found', 'invalid flow state, no valid flow state found');
        codes.delete(String(body.auth_code));
        const challenge = createHash('sha256').update(String(body.code_verifier ?? '')).digest('base64url');
        if (challenge !== c.challenge) return authError(res, 403, 'bad_code_verifier', 'code challenge does not match previously saved code verifier');
        return send(res, 200, sessionJson(findUser(`lower(email) = ${quote(c.email)}`)));
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
        const sub = subjectOf(req);
        const user = sub ? findUser(`id = ${quote(sub)}`) : null;
        if (!user) return authError(res, 401, 'no_authorization', 'No session');
        if (body.password !== undefined) {
          if (String(body.password).length < 8) return authError(res, 422, 'weak_password', 'Password should be at least 8 characters');
          passwords.set(user.id, String(body.password));
        }
        return send(res, 200, userJson(user));
      }
      if (url.pathname === '/auth/v1/user') {
        const sub = subjectOf(req);
        const user = sub ? findUser(`id = ${quote(sub)}`) : null;
        return user ? send(res, 200, userJson(user)) : authError(res, 401, 'no_authorization', 'No session');
      }
      if (url.pathname === '/auth/v1/logout') return send(res, 204);

      // ---- database: forwarded to Postgres as the caller ---------------------
      const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
      if (rpc && req.method === 'POST') {
        const args = Object.entries(body)
          .map(([name, value]) => {
            if (!/^[a-z_]+$/.test(name)) throw new Error(`bad argument name ${name}`);
            return `${name} => ${literal(value)}`;
          })
          .join(', ');
        const out = asUser(subjectOf(req), `select public.${rpc[1]}(${args});`);
        return out === '' ? send(res, 204) : send(res, 200, out);
      }
      if (url.pathname === '/rest/v1/devices' && req.method === 'DELETE') {
        const id = /^eq\.([0-9a-f-]{36})$/.exec(url.searchParams.get('id') ?? '');
        if (!id) return send(res, 400, { message: 'only id=eq.<uuid> is supported' });
        asUser(subjectOf(req), `delete from public.devices where id = ${quote(id[1])};`);
        return send(res, 204);
      }

      return send(res, 404, { message: `mock-supabase has no route for ${req.method} ${url.pathname}` });
    } catch (error) {
      const message = String(error.stderr || error.message || error).trim();
      console.log(`  -> error: ${message.split('\n')[0]}`);
      const denied = /permission denied|row-level security/.test(message);
      return send(res, denied ? 403 : 400, { message, code: denied ? '42501' : 'P0001' });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock-supabase listening on http://127.0.0.1:${PORT} (database ${DB})`));
