// 저녁 9시 복습 알림 (웹 푸시). 열쇠(VAPID)는 DB 설정(app_config)에 있음
import webpush from 'npm:web-push@3.6.7';

export interface Sub { endpoint: string; keys: { p256dh: string; auth: string } }

let ready = false;
export function initPush(publicKey: string, privateKey: string) {
  if (ready || !publicKey || !privateKey) return ready;
  webpush.setVapidDetails('mailto:study-app@example.com', publicKey, privateKey);
  ready = true;
  return ready;
}

/** 보내기. 구독이 만료됐으면(404/410) 'gone'을 돌려줘 지우게 함 */
export async function sendPush(sub: Sub, payload: { title: string; body: string; url?: string }): Promise<'ok' | 'gone' | string> {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 6 * 3600 });
    return 'ok';
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) return 'gone';
    return `${e?.statusCode ?? ''} ${e?.body ?? e?.message ?? e}`.slice(0, 200);
  }
}
