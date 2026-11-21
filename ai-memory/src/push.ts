// 알림 켜기: 환경 판별 + 구독
import { api } from './api';

export type PushSupport = 'ok' | 'need-home-screen' | 'unsupported';

function isIos(nav: Navigator): boolean {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  // iPadOS 는 맥처럼 보이므로 터치 지원 여부로 구분
  return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
}

export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

export function canEnablePush(nav: Navigator, standalone: boolean): PushSupport {
  if (isIos(nav) && !standalone) return 'need-home-screen';
  if (!('serviceWorker' in nav) || typeof PushManager === 'undefined') return 'unsupported';
  return 'ok';
}

export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type Call = <T>(path: string, init?: RequestInit) => Promise<T>;

/** 홈 화면 추가 전(iOS)이거나 미지원이면 구독을 시도하지 않고 그 상태를 돌려준다 */
export async function enablePush(
  o: { nav?: Navigator; standalone?: boolean; call?: Call } = {},
): Promise<PushSupport> {
  const nav = o.nav ?? navigator;
  const call = o.call ?? api;
  const status = canEnablePush(nav, o.standalone ?? isStandalone());
  if (status !== 'ok') return status;
  await nav.serviceWorker.register('./sw.js');
  const reg = await nav.serviceWorker.ready;
  const { key } = await call<{ key: string }>('/push/key');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource });
  await call('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
  return 'ok';
}
