// 서버(Supabase Edge Function) 호출. 로그인 토큰은 이 기기에만 저장
export const API = 'https://avtncptgsubamsfhxorz.supabase.co/functions/v1/api';

export interface Word { word: string; lemma: string; pos: string; ipa: string; meaning_ko: string; example_en: string }
export interface Card {
  id: string; ko: string; en: string; alts: string[]; note: string; words: Word[];
  stage: number; due: number; listens: number; reviews: number; lapses: number; created_at: number; updated_at: number;
}
export interface Expression { en: string; alts: string[]; note_ko: string; words: Word[]; model: string }
export interface User { id: string; name: string; is_admin: boolean }
export interface Stats { xp: number; streak: number; last_study_day: string | null; best_combo: number; pet_name: string }
export type Grade = 'again' | 'hard' | 'good';

const TOKEN_KEY = 'study.token';
let token = '';
try { token = localStorage.getItem(TOKEN_KEY) ?? ''; } catch { /* 사생활 보호 모드 */ }
export const hasToken = () => !!token;
export function setToken(t: string) {
  token = t;
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
/** 로그인이 풀렸을 때 화면에서 처리 */
export let onUnauthorized = () => {};
export const setOnUnauthorized = (f: () => void) => { onUnauthorized = f; };

async function req<T>(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: any) {
    throw new ApiError(0, e?.name === 'TimeoutError' ? '서버 응답이 너무 늦어요. 다시 시도해 주세요' : '인터넷 연결을 확인해 주세요');
  }
  const data: any = await res.json().catch(() => ({}));
  if (res.status === 401 && token && path !== '/login') { setToken(''); onUnauthorized(); }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `오류가 났어요 (${res.status})`);
  return data as T;
}

export const api = {
  status: () => req<{ setup_needed: boolean; gemini_key: boolean }>('GET', '/status'),
  setup: (name: string, password: string) => req<{ token: string; user: User }>('POST', '/setup', { name, password }),
  login: (name: string, password: string) => req<{ token: string; user: User }>('POST', '/login', { name, password }),
  logout: () => req('POST', '/logout', {}),
  me: () => req<{ user: User }>('GET', '/me'),
  addUser: (name: string, password: string) => req<{ user: User }>('POST', '/users', { name, password }),

  cards: () => req<{ cards: Card[] }>('GET', '/cards').then((r) => r.cards),
  createCard: (c: { ko: string; en: string; alts: string[]; note: string; words: Word[]; listens: number }) =>
    req<{ card: Card }>('POST', '/cards', c).then((r) => r.card),
  review: (id: string, grade: Grade, listened: number) => req<{ card: Card; listen_now: number }>('POST', `/cards/${id}/review`, { grade, listened }),
  listen: (id: string, count: number) => req<{ card: Card }>('POST', `/cards/${id}/listen`, { count }).then((r) => r.card),
  addWords: (id: string, words: Word[]) => req<{ card: Card }>('POST', `/cards/${id}/words`, { words }).then((r) => r.card),
  deleteCard: (id: string) => req('DELETE', `/cards/${id}`),

  importBackup: (cards: unknown[], stats: unknown) => req<{ imported: number; skipped: number }>('POST', '/import', { cards, stats }, 120_000),
  pushKey: () => req<{ key: string }>('GET', '/push/key').then((r) => r.key),
  pushSubscribe: (subscription: unknown) => req('POST', '/push/subscribe', { subscription }),
  pushUnsubscribe: (endpoint: string) => req('PUT', '/push/subscribe', { endpoint }),
  pushTest: () => req<{ sent: number; removed: number; failed: string[] }>('POST', '/push/test', {}),

  stats: () => req<{ stats: Stats }>('GET', '/stats').then((r) => r.stats),
  saveStats: (s: Partial<Stats>) => req<{ stats: Stats }>('PUT', '/stats', s).then((r) => r.stats),

  express: (ko: string) => req<Expression>('POST', '/ai/express', { ko }, 90_000),
  word: (word: string, sentence: string) => req<{ word: Word }>('POST', '/ai/word', { word, sentence }, 60_000).then((r) => r.word),
  transcribe: (audio: string, mime: string) => req<{ text: string }>('POST', '/ai/transcribe', { audio, mime }, 90_000).then((r) => r.text),
  tts: (text: string) => req<{ url: string; cached: boolean }>('POST', '/tts', { text }, 90_000).then((r) => r.url),
};
