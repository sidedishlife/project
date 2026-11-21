// 서비스 권한 DB 클라이언트와 app_config 읽기/쓰기
import { createClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

// 테스트에서 import만 해도 터지지 않도록 환경변수가 없으면 자리표시 값을 쓴다 (연결은 실제 호출 때만 일어남)
export const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? 'http://localhost:54321',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'missing-service-role-key',
  { auth: { persistSession: false } },
);

// deno-lint-ignore no-explicit-any
export async function config<K extends string>(keys: K[]): Promise<Record<K, any>> {
  const { data, error } = await db.from('app_config').select('key, value').in('key', keys);
  if (error) throw new HttpError(500, error.message);
  // deno-lint-ignore no-explicit-any
  return Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value])) as Record<K, any>;
}

export async function setConfig(key: string, value: unknown): Promise<void> {
  const { error } = await db.from('app_config').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new HttpError(500, error.message);
}
