import { assertEquals } from 'jsr:@std/assert@1';
import { applyMask } from './masking.ts';

Deno.test('긴 항목 먼저 치환', () => assertEquals(applyMask('A사업부와 A사', [{term:'A사',alias:'발주처1'},{term:'A사업부',alias:'부서1'}]), '부서1와 발주처1'));
Deno.test('정규식 특수문자 안전', () => assertEquals(applyMask('P&ID (rev.2)', [{term:'(rev.2)',alias:'(rev)'}]), 'P&ID (rev)'));
Deno.test('빈 목록이면 그대로', () => assertEquals(applyMask('abc', []), 'abc'));
Deno.test('빈 term은 무시', () => assertEquals(applyMask('abc', [{term:'',alias:'X'}]), 'abc'));
Deno.test('치환 결과는 다시 치환되지 않음', () => assertEquals(applyMask('가나', [{term:'가',alias:'나'},{term:'나',alias:'다'}]), '나다'));
