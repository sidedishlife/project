import { beforeEach, describe, expect, it, vi } from 'vitest';

function stubEnv(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  return store;
}
const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('api()', () => {
  it('401이면 토큰을 지우고 login 이벤트를 낸다', async () => {
    const store = stubEnv(async () => res(401, { error: '로그인이 필요해요' }));
    store.set('aim_token', 'tok');
    const { api } = await import('./api');
    const onLogin = vi.fn();
    window.addEventListener('login', onLogin);
    await expect(api('/inbox')).rejects.toThrow('로그인이 필요해요');
    expect(store.has('aim_token')).toBe(false);
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('/login 401은 토큰을 지우지 않고 login 이벤트도 내지 않는다', async () => {
    const store = stubEnv(async () => res(401, { error: '이름 또는 비밀번호가 올바르지 않아요' }));
    store.set('aim_token', 'tok');
    const { api, ApiError } = await import('./api');
    const onLogin = vi.fn();
    window.addEventListener('login', onLogin);
    const err = (await api('/login', { method: 'POST' }).catch((e: unknown) => e)) as InstanceType<typeof ApiError>;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('이름 또는 비밀번호가 올바르지 않아요');
    expect(store.get('aim_token')).toBe('tok');
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('토큰을 Authorization 헤더로 보내고 JSON을 돌려준다', async () => {
    const store = stubEnv(async () => res(200, { ok: 1 }));
    store.set('aim_token', 'tok');
    const { api } = await import('./api');
    expect(await api<{ ok: number }>('/x', { method: 'POST', body: JSON.stringify({ a: 1 }) })).toEqual({ ok: 1 });
    const [, init] = (fetch as any).mock.calls[0];
    expect(init.headers.get('Authorization')).toBe('Bearer tok');
    expect(init.headers.get('Content-Type')).toBe('application/json');
  });

  it('그 외 오류는 서버의 한국어 메시지를 담아 던진다', async () => {
    stubEnv(async () => res(409, { error: '이미 설정이 끝났어요. 로그인해 주세요' }));
    const { api, ApiError } = await import('./api');
    const err = (await api('/setup', { method: 'POST' }).catch((e: unknown) => e)) as InstanceType<typeof ApiError>;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('이미 설정이 끝났어요. 로그인해 주세요');
    expect(err.status).toBe(409);
  });

  it('localStorage가 막혀 있어도 동작한다', async () => {
    stubEnv(async () => res(200, {}));
    vi.stubGlobal('localStorage', { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } });
    const { api, setToken } = await import('./api');
    expect(() => setToken('a')).not.toThrow();
    await expect(api('/x')).resolves.toEqual({});
  });
});
