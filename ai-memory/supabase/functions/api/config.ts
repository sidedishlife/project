// 설정 변경 검증 (순수 함수 — DB 접근 없음)
import { HttpError } from './http.ts';

export const CONFIG_DEFAULTS = {
  ai_model: 'claude-haiku-5-5',
  daily_goal: 5,
  slots: { morning: '07:30', evening: '18:30', bedtime: '23:00' },
  mask_enabled: false,
} as const;

/** app_config 행(key→value)에 기본값을 채운다. 저장된 값이 있으면 그대로 쓴다. */
// deno-lint-ignore no-explicit-any
export function withDefaults(rows: Record<string, any>): Record<string, any> {
  const out = { ...rows };
  for (const [k, v] of Object.entries(CONFIG_DEFAULTS)) if (out[k] === undefined || out[k] === null) out[k] = structuredClone(v);
  return out;
}

const SLOT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLOT_KEYS = ['morning', 'evening', 'bedtime'] as const;

/** PATCH /config 본문을 검사해 저장할 키·값만 돌려준다. 허용되지 않은 키나 잘못된 값은 400. */
export function validateConfigPatch(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '요청 형식이 올바르지 않아요');
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    switch (k) {
      case 'ai_model':
        if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, 'ai_model은 비어 있지 않은 문자열이어야 해요');
        out[k] = v.trim();
        break;
      case 'daily_goal':
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 50) throw new HttpError(400, 'daily_goal은 1~50 사이 정수여야 해요');
        out[k] = v;
        break;
      case 'slots': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'slots 형식이 올바르지 않아요');
        const s = v as Record<string, unknown>;
        const slots: Record<string, string> = {};
        for (const name of SLOT_KEYS) {
          const t = s[name];
          if (typeof t !== 'string' || !SLOT_RE.test(t)) throw new HttpError(400, `slots.${name}은 HH:MM 형식이어야 해요`);
          slots[name] = t;
        }
        for (const extra of Object.keys(s)) if (!(SLOT_KEYS as readonly string[]).includes(extra)) throw new HttpError(400, `허용되지 않은 슬롯: ${extra}`);
        out[k] = slots;
        break;
      }
      case 'mask_enabled':
        if (typeof v !== 'boolean') throw new HttpError(400, 'mask_enabled는 true/false여야 해요');
        out[k] = v;
        break;
      default:
        throw new HttpError(400, `바꿀 수 없는 설정이에요: ${k}`);
    }
  }
  return out;
}
