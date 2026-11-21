import { assertEquals } from 'jsr:@std/assert@1';
import { hashPassword, verifyPassword } from './auth.ts';

Deno.test('올바른 비밀번호는 통과', async () => {
  assertEquals(await verifyPassword('secret-pw', await hashPassword('secret-pw')), true);
});
Deno.test('틀린 비밀번호는 거부', async () => {
  assertEquals(await verifyPassword('wrong', await hashPassword('secret-pw')), false);
});
Deno.test('pbkdf2$ 형식이 아니면 거부', async () => {
  assertEquals(await verifyPassword('x', 'plain$1$2$3'), false);
  assertEquals(await verifyPassword('x', 'garbage'), false);
});
Deno.test('같은 비밀번호도 해시는 매번 다름(솔트)', async () => {
  assertEquals(await hashPassword('same') === await hashPassword('same'), false);
});
