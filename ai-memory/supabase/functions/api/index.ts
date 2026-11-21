// AI 기억장 서버. 모든 데이터 접근은 이 함수를 거친다(service role, 바깥 직접 접근은 RLS로 막혀 있음).
// 주소: https://<project>.supabase.co/functions/v1/api/<경로>
import { db, config, setConfig } from './db.ts';
import { CORS, HttpError, json } from './http.ts';
import { hashPassword, newSession, pbkdf2, requireUser, verifyPassword } from './auth.ts';
import { validateConfigPatch } from './config.ts';


function validName(v: unknown) {
  const s = String(v ?? '').trim();
  if (s.length < 1 || s.length > 30) throw new HttpError(400, '이름은 1~30자로 입력해 주세요');
  return s;
}
function validPassword(v: unknown) {
  const s = String(v ?? '');
  if (s.length < 6) throw new HttpError(400, '비밀번호는 6자 이상으로 해 주세요');
  return s;
}

const hexOf = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
const newMcpSecret = () => hexOf(crypto.getRandomValues(new Uint8Array(32)));
const mcpUrl = (secret: unknown) =>
  typeof secret === 'string' && secret ? `${Deno.env.get('SUPABASE_URL')}/functions/v1/api/mcp/${secret}` : null;

/** 화면에 내려줄 설정. 비밀값(mcp_secret 원본, cron_secret, vapid_private)은 절대 포함하지 않는다. */
async function publicConfig() {
  const c = await config(['ai_model', 'daily_goal', 'slots', 'mask_enabled', 'mcp_secret']);
  return {
    ai_model: c.ai_model,
    daily_goal: c.daily_goal,
    slots: c.slots,
    mask_enabled: c.mask_enabled,
    mcp_url: mcpUrl(c.mcp_secret),
  };
}

export async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // /functions/v1/api/xxx 또는 /api/xxx 모두 처리
  const path = url.pathname.replace(/^.*\/api(?=\/|$)/, '') || '/';
  const m = req.method;
  const body = async (): Promise<Record<string, any>> => { // deno-lint-ignore no-explicit-any
    if (m === 'GET' || m === 'DELETE') return {};
    const b = await req.json().catch(() => { throw new HttpError(400, '요청 형식이 올바르지 않아요'); });
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, '요청 형식이 올바르지 않아요');
    return b;
  };

  // 처음 사용자 만들기: 사용자가 0명일 때만
  if (m === 'POST' && path === '/setup') {
    const b = await body();
    const name = validName(b.name), password = validPassword(b.password);
    const { count, error: cErr } = await db.from('users').select('id', { count: 'exact', head: true });
    if (cErr) throw new HttpError(500, cErr.message);
    if ((count ?? 0) > 0) throw new HttpError(409, '이미 설정이 끝났어요. 로그인해 주세요');
    const { data, error } = await db.from('users').insert({ name, password_hash: await hashPassword(password) }).select('id, name').single();
    // 동시에 두 번 불려도 DB의 유니크 인덱스(users_single)가 한 명만 허용
    if (error) throw new HttpError(error.code === '23505' ? 409 : 500, error.code === '23505' ? '이미 설정이 끝났어요. 로그인해 주세요' : error.message);
    return json({ token: await newSession(data.id), user: data });
  }

  if (m === 'POST' && path === '/login') {
    const b = await body();
    const name = validName(b.name);
    const { data, error } = await db.from('users').select('id, name, password_hash').eq('name', name).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    // 이름이 없을 때도 같은 시간·같은 메시지 (이름 존재 여부를 알려주지 않음)
    const ok = data ? await verifyPassword(String(b.password ?? ''), data.password_hash) : (await pbkdf2('x', new Uint8Array(16), 100_000), false);
    if (!ok || !data) throw new HttpError(401, '이름 또는 비밀번호가 맞지 않아요');
    return json({ token: await newSession(data.id), user: { id: data.id, name: data.name } });
  }

  // ── 여기부터 로그인 필요
  await requireUser(req);

  if (path === '/config') {
    if (m === 'GET') return json(await publicConfig());
    if (m === 'PATCH') {
      const patch = validateConfigPatch(await body());
      for (const [k, v] of Object.entries(patch)) await setConfig(k, v);
      return json(await publicConfig());
    }
  }

  if (m === 'POST' && path === '/config/rotate-mcp') {
    const secret = newMcpSecret();
    await setConfig('mcp_secret', secret);
    return json({ mcp_url: mcpUrl(secret) });
  }

  if (path === '/mask-terms') {
    if (m === 'GET') {
      const { data, error } = await db.from('mask_terms').select('term, alias').order('term');
      if (error) throw new HttpError(500, error.message);
      return json({ terms: data ?? [] });
    }
    if (m === 'PUT') { // 목록 통째 교체
      const b = await body();
      if (!Array.isArray(b.terms)) throw new HttpError(400, 'terms는 목록이어야 해요');
      const seen = new Set<string>();
      const rows: { term: string; alias: string }[] = [];
      for (const t of b.terms) {
        const term = String(t?.term ?? '').trim(), alias = String(t?.alias ?? '').trim();
        if (!term || !alias) throw new HttpError(400, '가릴 말과 바꿀 말을 모두 입력해 주세요');
        if (seen.has(term)) throw new HttpError(400, `중복된 항목이에요: ${term}`);
        seen.add(term);
        rows.push({ term, alias });
      }
      const { error } = await db.rpc('replace_mask_terms', { terms: rows }); // 삭제+삽입을 한 트랜잭션으로
      if (error) throw new HttpError(500, error.message);
      return json({ terms: rows });
    }
  }

  throw new HttpError(404, '없는 경로예요');
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    try {
      return await route(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: '서버에서 문제가 생겼어요' }, 500);
    }
});
