/** Where the signed-in session is kept. Android/iOS: encrypted storage, in chunks. */
import { createChunkedStorage } from './chunked-storage';
import { kv } from './kv';

export const sessionStorage = createChunkedStorage(kv);
