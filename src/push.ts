// 저녁 9시 복습 알림 (웹 푸시)
// 아이폰: iOS 16.4 이상 + '홈 화면에 추가'로 설치한 앱에서만 알림을 받을 수 있음 (사파리 탭에서는 불가)
import { api } from './api';

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

export async function pushState(): Promise<{ on: boolean; can: boolean; note: string }> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { on: false, can: false, note: isIOS() && !standalone()
      ? '아이폰은 사파리 공유 버튼 → "홈 화면에 추가"로 설치한 뒤, 홈 화면 아이콘으로 열어야 알림을 켤 수 있어요'
      : '이 브라우저는 알림을 지원하지 않아요' };
  }
  if (Notification.permission === 'denied') return { on: false, can: false, note: '알림이 차단돼 있어요. 휴대폰 설정 → 알림에서 이 앱을 허용해 주세요' };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? { on: true, can: true, note: '켜져 있어요. 복습할 카드가 있는 날 저녁 9시에 알려 드려요' } : { on: false, can: true, note: '꺼져 있어요' };
}

function keyBytes(b64: string) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림을 허용해야 받을 수 있어요');
  const reg = await navigator.serviceWorker.register('./sw.js');
  await navigator.serviceWorker.ready;
  const key = await api.pushKey();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await api.pushSubscribe(sub.toJSON());
  return true;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await api.pushUnsubscribe(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
}
