import { describe, expect, it, vi } from 'vitest';
import { canEnablePush, enablePush, urlBase64ToUint8Array } from './push';

const nav = (o: Record<string, unknown>) => o as unknown as Navigator;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) Chrome/120';

describe('canEnablePush', () => {
  it('아이폰 + 홈 화면 앱 아님 → need-home-screen', () => {
    expect(canEnablePush(nav({ userAgent: IPHONE, serviceWorker: {} }), false)).toBe('need-home-screen');
  });
  it('아이패드(데스크톱 UA + 터치)도 need-home-screen', () => {
    const n = nav({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5, serviceWorker: {} });
    expect(canEnablePush(n, false)).toBe('need-home-screen');
  });
  it('터치 없는 맥은 iOS가 아니다', () => {
    const n = nav({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0, serviceWorker: {} });
    vi.stubGlobal('PushManager', class {});
    expect(canEnablePush(n, false)).toBe('ok');
    vi.unstubAllGlobals();
  });
  it('홈 화면 앱(standalone)이면 ok', () => {
    vi.stubGlobal('PushManager', class {});
    expect(canEnablePush(nav({ userAgent: IPHONE, serviceWorker: {} }), true)).toBe('ok');
    vi.unstubAllGlobals();
  });
  it('serviceWorker 또는 PushManager 없음 → unsupported', () => {
    vi.stubGlobal('PushManager', class {});
    expect(canEnablePush(nav({ userAgent: ANDROID }), false)).toBe('unsupported');
    vi.unstubAllGlobals();
    expect(canEnablePush(nav({ userAgent: ANDROID, serviceWorker: {} }), false)).toBe('unsupported');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('패딩 없는 base64url을 바이트로 바꾼다', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array('AQI')]).toEqual([1, 2]);
  });
  it('- 와 _ 를 + 와 / 로 본다', () => {
    expect([...urlBase64ToUint8Array('-__-')]).toEqual([0xfb, 0xff, 0xfe]);
  });
});

describe('enablePush', () => {
  it('아이폰 홈 화면 추가 전에는 구독을 시도하지 않는다', async () => {
    const register = vi.fn();
    const post = vi.fn();
    const r = await enablePush({
      nav: nav({ userAgent: IPHONE, serviceWorker: { register } }), standalone: false, call: post as never,
    });
    expect(r).toBe('need-home-screen');
    expect(register).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it('ok면 키를 받아 구독하고 서버에 보낸다', async () => {
    vi.stubGlobal('PushManager', class {});
    const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: 'https://x', keys: { p256dh: 'a', auth: 'b' } }) }));
    const register = vi.fn(async () => ({}));
    const call = vi.fn(async (path: string) => (path === '/push/key' ? { key: 'AQID' } : { ok: true }));
    const n = nav({
      userAgent: ANDROID,
      serviceWorker: { register, ready: Promise.resolve({ pushManager: { subscribe } }) },
    });
    const order: string[] = [];
    register.mockImplementation(async () => { order.push('register'); return {}; });
    const requestPermission = vi.fn(async () => { order.push('perm'); return 'granted' as NotificationPermission; });
    const r = await enablePush({ nav: n, standalone: false, call: call as never, requestPermission });
    expect(r).toBe('ok');
    expect(order).toEqual(['perm', 'register']);
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) });
    expect(call).toHaveBeenCalledWith('/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: 'https://x', keys: { p256dh: 'a', auth: 'b' } }) });
    vi.unstubAllGlobals();
  });
  it('권한 요청이 거절되면 등록·구독·서버 전송을 하지 않는다', async () => {
    vi.stubGlobal('PushManager', class {});
    const register = vi.fn();
    const call = vi.fn();
    const r = await enablePush({
      nav: nav({ userAgent: ANDROID, serviceWorker: { register } }), standalone: false, call: call as never,
      requestPermission: async () => 'denied',
    });
    expect(r).toBe('denied');
    expect(register).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
