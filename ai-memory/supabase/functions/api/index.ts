// AI 기억장 서버. 모든 데이터 접근은 이 함수를 거친다(service role, 바깥 직접 접근은 RLS로 막혀 있음).
// 주소: https://<project>.supabase.co/functions/v1/api/<경로>
import { db, config, setConfig, dbErrorToHttp } from './db.ts';
import { CORS, HttpError, json } from './http.ts';
import { hashPassword, newSession, pbkdf2, requireUser, verifyPassword } from './auth.ts';
import { validateConfigPatch } from './config.ts';
import { supabaseRepo } from './repo.ts';
import { confirmCandidate, getNote, listNotes, pasteConversation, type Decision, type IngestDeps } from './ingest.ts';
import * as ai from './ai.ts';
import { handleMcpRequest, safeEqual } from './mcp.ts';
import { generateVapidKeys, initPush, sendPush, type Sub } from './push.ts';
import { remind } from './remind.ts';
import { submitCandidates } from './ingest.ts';
import { reveal, submitGrade, todayAvailable, todayResponse, type ReviewDeps } from './review.ts';

const repo = supabaseRepo();
/** 실제 저장소·AI·설정을 묶은 ingest 의존성 (요청마다 설정을 새로 읽는다) */
async function ingestDeps(): Promise<IngestDeps> {
  const c = await config(['ai_model', 'slots', 'mask_enabled']);
  const opts = { model: c.ai_model as string };
  return {
    repo,
    ai: {
      matchConcept: (cand, existing) => ai.matchConcept(cand, existing, opts),
      mergeNote: (o, a) => ai.mergeNote(o, a, opts),
      compareQuestion: (a, b) => ai.compareQuestion(a, b, opts),
      extractCandidates: (t) => ai.extractCandidates(t, opts),
    },
    now: () => new Date(),
    config: { mask_enabled: !!c.mask_enabled, slots: c.slots },
  };
}

async function reviewDeps(): Promise<ReviewDeps> {
  const c = await config(['ai_model', 'daily_goal', 'mask_enabled']);
  const opts = { model: c.ai_model as string };
  return {
    repo,
    ai: { gradeAnswer: (q, n, a) => ai.gradeAnswer(q, n, a, opts) },
    now: () => new Date(),
    config: { daily_goal: Number(c.daily_goal), mask_enabled: !!c.mask_enabled },
  };
}

async function loadSubs(): Promise<Sub[]> {
  const { data, error } = await db.from('push_subscriptions').select('endpoint, keys');
  if (error) throw dbErrorToHttp(error);
  return (data ?? []) as Sub[];
}

/** 공개 열쇠. 아직 없으면 한 쌍을 만들어 저장(한 번만). */
async function vapidPublicKey(): Promise<string> {
  const c = await config(['vapid_public', 'vapid_private']);
  if (typeof c.vapid_public === 'string' && c.vapid_public && typeof c.vapid_private === 'string' && c.vapid_private) return c.vapid_public;
  const k = generateVapidKeys();
  await setConfig('vapid_public', k.publicKey);
  await setConfig('vapid_private', k.privateKey);
  return k.publicKey;
}

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

/** 경로 조각 디코딩. 잘못된 퍼센트 인코딩이면 null */
function safeDecode(s: string): string | null {
  try { return decodeURIComponent(s); } catch { return null; }
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
    if (cErr) throw dbErrorToHttp(cErr);
    if ((count ?? 0) > 0) throw new HttpError(409, '이미 설정이 끝났어요. 로그인해 주세요');
    const { data, error } = await db.from('users').insert({ name, password_hash: await hashPassword(password) }).select('id, name').single();
    // 동시에 두 번 불려도 DB의 유니크 인덱스(users_single)가 한 명만 허용
    if (error) throw error.code === '23505' ? new HttpError(409, '이미 설정이 끝났어요. 로그인해 주세요') : dbErrorToHttp(error);
    return json({ token: await newSession(data.id), user: data });
  }

  if (m === 'POST' && path === '/login') {
    const b = await body();
    const name = validName(b.name);
    const { data, error } = await db.from('users').select('id, name, password_hash').eq('name', name).maybeSingle();
    if (error) throw dbErrorToHttp(error);
    // 이름이 없을 때도 같은 시간·같은 메시지 (이름 존재 여부를 알려주지 않음)
    const ok = data ? await verifyPassword(String(b.password ?? ''), data.password_hash) : (await pbkdf2('x', new Uint8Array(16), 100_000), false);
    if (!ok || !data) throw new HttpError(401, '이름 또는 비밀번호가 맞지 않아요');
    return json({ token: await newSession(data.id), user: { id: data.id, name: data.name } });
  }

  // MCP: 앱 로그인 없이 경로의 비밀값이 인증 (requireUser보다 먼저)
  const mcpM = path.match(/^\/mcp\/([^/]+)$/);
  if (mcpM) {
    const secret = safeDecode(mcpM[1]);
    if (secret === null) throw new HttpError(404, '없는 경로예요'); // 잘못된 인코딩은 틀린 비밀값과 같게 처리
    const { mcp_secret } = await config(['mcp_secret']);
    return await handleMcpRequest(req, secret, typeof mcp_secret === 'string' ? mcp_secret : null,
      async (source, items) => submitCandidates(await ingestDeps(), source, items));
  }

  // 복습 알림 cron: 앱 로그인 없이 x-cron-secret 헤더가 인증 (requireUser보다 먼저)
  if (m === 'POST' && path === '/cron/remind') {
    const { cron_secret, vapid_public, vapid_private, slots } = await config(['cron_secret', 'vapid_public', 'vapid_private', 'slots']);
    const stored = typeof cron_secret === 'string' ? cron_secret : '';
    const given = req.headers.get('x-cron-secret') ?? '';
    // 저장된 값이 없으면 항상 거절 (빈 문자열끼리 일치해 통과하는 일이 없도록)
    if (!stored || !(await safeEqual(given, stored))) throw new HttpError(403, '허용되지 않았어요');
    if (!initPush(vapid_public, vapid_private)) return json({ slot: null, count: 0, sent: 0, removed: 0, failed: 0 });
    const rd = await reviewDeps();
    return json(await remind(new Date(), {
      slots,
      count: () => todayAvailable(new Date(), rd),
      subs: loadSubs,
      send: sendPush,
      remove: async (endpoint) => { await db.from('push_subscriptions').delete().eq('endpoint', endpoint); },
    }));
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
      if (error) throw dbErrorToHttp(error);
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
      if (error) throw dbErrorToHttp(error);
      return json({ terms: rows });
    }
  }

  if (m === 'GET' && path === '/push/key') return json({ key: await vapidPublicKey() });

  if (path === '/push/subscribe') {
    if (m === 'POST') {
      const b = await body();
      const endpoint = String(b.endpoint ?? '');
      const keys = b.keys;
      if (!endpoint.startsWith('https://') || !keys?.p256dh || !keys?.auth) throw new HttpError(400, '구독 정보가 올바르지 않아요');
      const { error } = await db.from('push_subscriptions').upsert({ endpoint, keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) } }, { onConflict: 'endpoint' });
      if (error) throw dbErrorToHttp(error);
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      const endpoint = url.searchParams.get('endpoint');
      if (!endpoint) throw new HttpError(400, 'endpoint가 필요해요');
      const { error } = await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
      if (error) throw dbErrorToHttp(error);
      return json({ ok: true });
    }
  }

  if (m === 'POST' && path === '/push/test') {
    const { vapid_public, vapid_private } = await config(['vapid_public', 'vapid_private']);
    if (!initPush(vapid_public, vapid_private)) throw new HttpError(400, '알림 열쇠가 아직 없어요');
    let sent = 0, removed = 0, failed = 0;
    for (const sub of await loadSubs()) {
      const r = await sendPush(sub, { title: 'AI 기억장', body: '알림이 잘 와요', url: '/' });
      if (r === 'ok') sent++;
      else if (r === 'gone') { await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); removed++; }
      else failed++;
    }
    return json({ sent, removed, failed });
  }

  if (m === 'GET' && path === '/inbox') return json({ candidates: await repo.listPendingCandidates() });

  const confirmM = path.match(/^\/inbox\/([^/]+)\/confirm$/);
  if (m === 'POST' && confirmM) {
    const b = await body();
    if (!['merge', 'new', 'pair', 'discard'].includes(b.action)) throw new HttpError(400, 'action이 올바르지 않아요');
    const decision: Decision = { action: b.action, target_id: b.target_id || undefined, field_id: b.field_id || undefined };
    await confirmCandidate(await ingestDeps(), confirmM[1], decision);
    return json({ ok: true });
  }

  if (m === 'POST' && path === '/paste') {
    const b = await body();
    const text = String(b.text ?? '').trim();
    if (!text) throw new HttpError(400, '붙여넣은 대화가 비어 있어요');
    return json(await pasteConversation(await ingestDeps(), text));
  }

  if (path === '/fields') {
    if (m === 'GET') return json({ fields: await repo.listFields() });
    if (m === 'POST') {
      const name = validName((await body()).name);
      return json(await repo.findFieldByName(name) ?? await repo.insertField(name));
    }
  }

  if (m === 'GET' && path === '/notes') {
    return json({ notes: await listNotes(repo, url.searchParams.get('q') ?? '', url.searchParams.get('field') || null) });
  }
  const noteM = path.match(/^\/notes\/([^/]+)$/);
  if (m === 'GET' && noteM) return json(await getNote(repo, noteM[1]));

  if (m === 'GET' && path === '/review/today') {
    // ?now=ISO 는 화면 확인용(출제 목록만 바뀜). 채점 시각은 항상 실제 시각.
    const nowQ = url.searchParams.get('now');
    const now = nowQ ? new Date(nowQ) : new Date();
    if (Number.isNaN(now.getTime())) throw new HttpError(400, 'now 형식이 올바르지 않아요');
    return json(await todayResponse(now, await reviewDeps()));
  }
  const revealM = path.match(/^\/review\/([^/]+)\/([^/]+)\/reveal$/);
  if (m === 'GET' && revealM) {
    const uid = safeDecode(revealM[2]);
    if (uid === null) throw new HttpError(404, '없는 경로예요');
    return json(await reveal(await reviewDeps(), revealM[1], uid));
  }
  if (m === 'POST' && path === '/review/grade') {
    const b = await body();
    return json(await submitGrade(await reviewDeps(), {
      unit_type: b.unit_type, unit_id: String(b.unit_id ?? ''), mode: b.mode,
      grade: b.grade ?? undefined, answer: b.answer ?? undefined, question_id: b.question_id ?? null,
    }));
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
