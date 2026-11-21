import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { CONFIG_DEFAULTS, validateConfigPatch, withDefaults } from './config.ts';
import { HttpError } from './http.ts';

const bad = (body: unknown) => {
  const e = assertThrows(() => validateConfigPatch(body), HttpError);
  assertEquals(e.status, 400);
};
const slots = { morning: '08:00', evening: '19:30', bedtime: '23:59' };

Deno.test('허용된 키는 통과', () => {
  const body = { ai_model: 'claude-haiku-5-5', daily_goal: 5, slots, mask_enabled: true };
  assertEquals(validateConfigPatch(body), body);
});
Deno.test('일부 키만 보내도 됨', () => assertEquals(validateConfigPatch({ daily_goal: 1 }), { daily_goal: 1 }));
Deno.test('허용되지 않은 키는 400 (비밀값 포함)', () => {
  bad({ mcp_secret: 'x' });
  bad({ cron_secret: 'x' });
  bad({ vapid_private: 'x' });
  bad({ daily_goal: 5, other: 1 });
});
Deno.test('daily_goal 범위·타입', () => {
  bad({ daily_goal: 0 });
  bad({ daily_goal: 51 });
  bad({ daily_goal: 2.5 });
  bad({ daily_goal: '5' });
  assertEquals(validateConfigPatch({ daily_goal: 50 }), { daily_goal: 50 });
});
Deno.test('slots 형식', () => {
  bad({ slots: { ...slots, morning: '24:00' } });
  bad({ slots: { ...slots, evening: '7:30' } });
  bad({ slots: { ...slots, bedtime: '12:60' } });
  bad({ slots: { morning: '08:00', evening: '19:00' } });
  bad({ slots: { ...slots, extra: '10:00' } });
  bad({ slots: 'x' });
  assertEquals(validateConfigPatch({ slots: { morning: '00:00', evening: '12:00', bedtime: '23:59' } }).slots, { morning: '00:00', evening: '12:00', bedtime: '23:59' });
});
Deno.test('mask_enabled / ai_model 타입', () => {
  bad({ mask_enabled: 'true' });
  bad({ ai_model: '' });
  bad({ ai_model: 5 });
});
Deno.test('본문이 객체가 아니면 400', () => {
  bad(null);
  bad([]);
  bad('x');
});

Deno.test('withDefaults: 빈 행이면 기본값 (slots 07:30/18:30/23:00, mask_enabled false)', () => {
  const d = withDefaults({});
  assertEquals(d.ai_model, 'claude-haiku-5-5');
  assertEquals(d.daily_goal, 5);
  assertEquals(d.slots, { morning: '07:30', evening: '18:30', bedtime: '23:00' });
  assertEquals(d.mask_enabled, false);
});
Deno.test('withDefaults: 저장된 값(false, 다른 목표)은 덮지 않고 다른 키는 보존', () => {
  const d = withDefaults({ daily_goal: 10, mask_enabled: true, mcp_secret: 's' });
  assertEquals(d.daily_goal, 10);
  assertEquals(d.mask_enabled, true);
  assertEquals(d.mcp_secret, 's');
  assertEquals(d.ai_model, CONFIG_DEFAULTS.ai_model);
});
