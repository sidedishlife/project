// 비밀번호(pbkdf2)·세션 토큰. 말해영어 앱 코드를 이식.
import { db } from './db.ts';
import { HttpError } from './http.ts';

const SESSION_DAYS = 180;
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iter: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iter = 100_000;
  return `pbkdf2$${iter}$${b64(salt)}$${b64(await pbkdf2(password, salt, iter))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, iter, salt, hash] = stored.split('$');
  if (kind !== 'pbkdf2' || !iter || !salt || !hash) return false;
  try {
    const got = await pbkdf2(password, unb64(salt), Number(iter));
    const want = unb64(hash);
    if (got.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i]; // 시간 차이로 비밀번호를 추측하지 못하게
    return diff === 0;
  } catch {
    return false;
  }
}

const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export async function newSession(userId: string): Promise<string> {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  const { error } = await db.from('sessions').insert({ token_hash: await sha256(token), user_id: userId, expires_at: expires });
  if (error) throw new HttpError(500, `세션 저장 실패: ${error.message}`);
  return token;
}

export async function requireUser(req: Request): Promise<{ id: string }> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, '로그인이 필요해요');
  const { data, error } = await db
    .from('sessions')
    .select('expires_at, user_id')
    .eq('token_hash', await sha256(token))
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data || new Date(data.expires_at) < new Date()) throw new HttpError(401, '로그인이 만료됐어요. 다시 로그인해 주세요');
  return { id: data.user_id as string };
}
