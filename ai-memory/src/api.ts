// 서버 호출 도구: 토큰 부착, 401 처리, 서버 한국어 오류 메시지 전달
const BASE = (import.meta.env?.VITE_API_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'aim_token';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string): void {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* 저장 불가 환경: 세션 동안만 유지 안 됨 */ }
}
export function clearToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없어요. 네트워크를 확인해 주세요');
  }
  const data = await res.json().catch(() => null);
  // 로그인/설정 요청의 401은 '비밀번호 틀림'이므로 세션 만료 처리를 하지 않는다
  if (res.status === 401 && path !== '/login' && path !== '/setup') {
    clearToken();
    window.dispatchEvent(new Event('login'));
  }
  if (!res.ok) {
    const msg = data && typeof data.error === 'string' ? data.error : `요청에 실패했어요 (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}
