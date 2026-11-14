/** Web: the browser's localStorage, as supabase-js does by default. */
import { kv } from './kv';

export const sessionStorage = kv;
