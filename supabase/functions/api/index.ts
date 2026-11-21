// Study 영어 앱 서버. 모든 데이터 접근은 이 함수를 거친다(관리자 권한, 바깥 직접 접근은 DB에서 막혀 있음).
// 주소: https://<project>.supabase.co/functions/v1/api/<경로>
import { createClient } from 'npm:@supabase/supabase-js@2';
import { express, lookup, transcribe, speak, geminiKey, AiError, VOICE, listModels, probe, setModels, image } from './gemini.ts';
import { initPush, sendPush, type Sub } from './push.ts';
import { schedule, firstDue, listensThisReview, FIRST_LISTENS, type Grade } from './srs.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const SESSION_DAYS = 180;
const CORS = {
  'Access-Control-Allow-Origin': '*', // 쿠키 없이 토큰으로만 인증하므로 출처 제한이 없어도 됨
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

// ───────────── 비밀번호·토큰 ─────────────
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iter: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iter = 100_000;
  return `pbkdf2$${iter}$${b64(salt)}$${b64(await pbkdf2(password, salt, iter))}`;
}
async function verifyPassword(password: string, stored: string) {
  const [kind, iter, salt, hash] = stored.split('$');
  if (kind !== 'pbkdf2') return false;
  const got = await pbkdf2(password, unb64(salt), Number(iter));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i]; // 시간 차이로 비밀번호를 추측하지 못하게
  return diff === 0;
}
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function newSession(userId: string) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  const { error } = await db.from('sessions').insert({ token_hash: await sha256(token), user_id: userId, expires_at: expires });
  if (error) throw new HttpError(500, `세션 저장 실패: ${error.message}`);
  return token;
}

interface User { id: string; name: string; is_admin: boolean }
async function requireUser(req: Request): Promise<User> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, '로그인이 필요해요');
  const { data, error } = await db
    .from('sessions')
    .select('expires_at, users(id, name, is_admin)')
    .eq('token_hash', await sha256(token))
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data || new Date(data.expires_at) < new Date()) throw new HttpError(401, '로그인이 만료됐어요. 다시 로그인해 주세요');
  return data.users as unknown as User;
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

// ───────────── 카드 ─────────────
const CARD_COLS = 'id, ko, en, alts, note, words, stage, due, listens, reviews, lapses, created_at, updated_at';
const toCard = (r: any) => ({ ...r, due: new Date(r.due).getTime(), created_at: new Date(r.created_at).getTime(), updated_at: new Date(r.updated_at).getTime() });

const asStrArray = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map((x) => String(x ?? '')).filter(Boolean).slice(0, max);
function asWords(v: unknown) {
  return (Array.isArray(v) ? v : []).slice(0, 40).map((w: any) => ({
    word: String(w?.word ?? ''), lemma: String(w?.lemma ?? ''), pos: String(w?.pos ?? ''),
    ipa: String(w?.ipa ?? ''), meaning_ko: String(w?.meaning_ko ?? ''), example_en: String(w?.example_en ?? ''),
  })).filter((w) => w.word);
}

async function getOwnCard(userId: string, id: string) {
  const { data, error } = await db.from('cards').select(CARD_COLS).eq('id', id).eq('user_id', userId).is('deleted_at', null).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, '카드를 찾을 수 없어요');
  return data;
}

// ───────────── 경로 처리 ─────────────
// 모델 순서 설정을 DB에서 읽음 (1분 캐시)
async function config(keys: string[]): Promise<Record<string, string>> {
  const { data } = await db.from('app_config').select('key, value').in('key', keys);
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

/** 복습할 카드가 있는 사람들(또는 한 사람)에게 알림 */
async function remindAll(cfg: Record<string, string>, onlyUser?: string, force = false) {
  if (!initPush(cfg.vapid_public, cfg.vapid_private)) throw new HttpError(500, '알림 열쇠가 설정되지 않았어요');
  let q = db.from('push_subscriptions').select('id, user_id, endpoint, keys');
  if (onlyUser) q = q.eq('user_id', onlyUser);
  const { data: subs, error } = await q;
  if (error) throw new HttpError(500, error.message);
  const result = { users: 0, sent: 0, removed: 0, failed: [] as string[] };
  const byUser = new Map<string, any[]>();
  for (const s of subs ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
  for (const [uid, list] of byUser) {
    const { count } = await db.from('cards').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('deleted_at', null).lte('due', new Date().toISOString());
    if (!count && !force) continue;
    result.users++;
    const payload = count
      ? { title: '복습할 시간이에요', body: `잊기 전에 복습할 카드가 ${count}장 있어요`, url: './' }
      : { title: '알림 시험', body: '알림이 잘 와요. 지금은 복습할 카드가 없어요', url: './' };
    for (const s of list) {
      const r = await sendPush({ endpoint: s.endpoint, keys: s.keys }, payload);
      if (r === 'ok') result.sent++;
      else if (r === 'gone') { await db.from('push_subscriptions').delete().eq('id', s.id); result.removed++; }
      else result.failed.push(r);
    }
  }
  return result;
}

let modelConfigAt = 0;
async function loadModelConfig() {
  if (Date.now() - modelConfigAt < 60_000) return;
  modelConfigAt = Date.now();
  const { data } = await db.from('app_config').select('key, value').in('key', ['text_models', 'tts_models']);
  const get = (k: string) => { const v = data?.find((r) => r.key === k)?.value; try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return undefined; } };
  setModels(get('text_models'), get('tts_models'));
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // /functions/v1/api/xxx 또는 /api/xxx 모두 처리
  const path = url.pathname.replace(/^.*\/api(?=\/|$)/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  const m = req.method;
  const body = async () => (m === 'GET' || m === 'DELETE' ? {} : await req.json().catch(() => { throw new HttpError(400, '요청 형식이 올바르지 않아요'); }));

  // 처음 설정이 필요한지 (관리자가 아직 없음)
  if (m === 'GET' && path === '/status') {
    const { count, error } = await db.from('users').select('id', { count: 'exact', head: true }).eq('is_admin', true);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true, setup_needed: (count ?? 0) === 0, gemini_key: !!geminiKey() });
  }

  // 처음 관리자 만들기: 관리자가 하나도 없을 때만
  if (m === 'POST' && path === '/setup') {
    const b = await body();
    const name = validName(b.name), password = validPassword(b.password);
    const { count } = await db.from('users').select('id', { count: 'exact', head: true }).eq('is_admin', true);
    if ((count ?? 0) > 0) throw new HttpError(403, '이미 설정이 끝났어요. 로그인해 주세요');
    const { data, error } = await db.from('users').insert({ name, pass_hash: await hashPassword(password), is_admin: true }).select('id, name, is_admin').single();
    if (error) throw new HttpError(error.code === '23505' ? 409 : 500, error.code === '23505' ? '이미 있는 이름이에요' : error.message);
    await db.from('stats').insert({ user_id: data.id });
    return json({ token: await newSession(data.id), user: data });
  }

  if (m === 'POST' && path === '/login') {
    const b = await body();
    const name = validName(b.name);
    const { data } = await db.from('users').select('id, name, is_admin, pass_hash').eq('name', name).maybeSingle();
    // 이름이 없을 때도 같은 시간·같은 메시지 (이름 존재 여부를 알려주지 않음)
    const ok = data ? await verifyPassword(String(b.password ?? ''), data.pass_hash) : (await pbkdf2('x', new Uint8Array(16), 100_000), false);
    if (!ok || !data) throw new HttpError(401, '이름 또는 비밀번호가 맞지 않아요');
    return json({ token: await newSession(data.id), user: { id: data.id, name: data.name, is_admin: data.is_admin } });
  }

  // ── 여기부터 로그인 필요
  // 매일 저녁 9시(DB 예약 작업)가 부름: 복습할 카드가 있는 사람에게 알림
  if (m === 'POST' && path === '/cron/remind') {
    const cfg = await config(['cron_secret', 'vapid_public', 'vapid_private']);
    if (!cfg.cron_secret || req.headers.get('x-cron-secret') !== cfg.cron_secret) throw new HttpError(403, '허용되지 않은 호출');
    return json(await remindAll(cfg));
  }
  // 관리자 도구: 게임 그림 만들기 (비밀값 필요). 결과는 저장소 art/ 에 저장
  if (m === 'POST' && path === '/admin/image') {
    const cfg = await config(['cron_secret']);
    if (!cfg.cron_secret || req.headers.get('x-cron-secret') !== cfg.cron_secret) throw new HttpError(403, '허용되지 않은 호출');
    const b = await body();
    const name = String(b.name ?? '').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || `img-${Date.now()}`;
    let ref: { data: string; mime: string } | undefined;
    if (b.ref) { // 참고 그림: 저장소 art/ 안의 파일 이름
      const { data: f } = await db.storage.from('audio').download(`art/${String(b.ref).replace(/[^a-z0-9_.-]/gi, '')}`);
      if (f) ref = { data: b64(new Uint8Array(await f.arrayBuffer())), mime: f.type || 'image/png' };
    }
    const out = await image(String(b.model || 'gemini-3.1-flash-image'), String(b.prompt ?? ''), ref);
    const ext = out.mime.includes('jpeg') ? 'jpg' : out.mime.includes('webp') ? 'webp' : 'png';
    const p = `art/${name}.${ext}`;
    const up = await db.storage.from('audio').upload(p, out.bytes, { contentType: out.mime, upsert: true });
    if (up.error) throw new HttpError(500, up.error.message);
    return json({ url: db.storage.from('audio').getPublicUrl(p).data.publicUrl, ms: out.ms, file: `${name}.${ext}` });
  }
  if (m === 'GET' && path === '/push/key') return json({ key: (await config(['vapid_public'])).vapid_public ?? '' });

  const user = await requireUser(req);

  // 알림 받기 등록/해제
  if (path === '/push/subscribe') {
    const b = await body();
    if (m === 'POST') {
      const sub = b.subscription as Sub;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new HttpError(400, '알림 등록 정보가 올바르지 않아요');
      const { error } = await db.from('push_subscriptions').upsert({ user_id: user.id, endpoint: sub.endpoint, keys: sub.keys }, { onConflict: 'endpoint' });
      if (error) throw new HttpError(500, error.message);
      return json({ ok: true });
    }
    if (m === 'PUT') { // 해제 (DELETE는 본문을 못 읽는 환경이 있어 PUT 사용)
      await db.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', String(b.endpoint ?? ''));
      return json({ ok: true });
    }
  }
  // 알림 시험: 지금 내 기기들로 보내 봄
  if (m === 'POST' && path === '/push/test') {
    const cfg = await config(['vapid_public', 'vapid_private']);
    return json(await remindAll(cfg, user.id, true));
  }

  // 예전 앱 백업 가져오기: 같은 영어 문장은 건너뛰고, 기록(단계·복습 시각·들은 횟수)은 그대로 살림
  if (m === 'POST' && path === '/import') {
    const b = await body();
    const list = Array.isArray(b.cards) ? b.cards.slice(0, 2000) : [];
    const { data: mine } = await db.from('cards').select('en').eq('user_id', user.id).is('deleted_at', null);
    const have = new Set((mine ?? []).map((c) => c.en.trim().toLowerCase()));
    const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d; };
    const rows = [];
    for (const c of list) {
      const en = String(c?.en ?? '').trim(), ko = String(c?.ko ?? '').trim();
      if (!en || !ko || have.has(en.toLowerCase())) continue;
      have.add(en.toLowerCase());
      const due = Number(c.due), created = Number(c.createdAt ?? c.created_at);
      rows.push({
        user_id: user.id, ko: ko.slice(0, 500), en: en.slice(0, 500), alts: asStrArray(c.alts, 3), note: String(c.note ?? '').slice(0, 1000), words: asWords(c.words),
        stage: num(c.stage, 0, 7, 0), listens: num(c.listens, 0, 1000, 0), reviews: num(c.reviews, 0, 10000, 0), lapses: num(c.lapses, 0, 10000, 0),
        due: new Date(Number.isFinite(due) && due > 0 ? due : firstDue()).toISOString(),
        ...(Number.isFinite(created) && created > 0 ? { created_at: new Date(created).toISOString() } : {}),
      });
    }
    if (rows.length) {
      const { error } = await db.from('cards').insert(rows);
      if (error) throw new HttpError(500, error.message);
    }
    // 경험치·연속일은 큰 값을 유지
    const s = b.stats ?? {};
    const { data: cur } = await db.from('stats').select('xp, streak, best_combo').eq('user_id', user.id).maybeSingle();
    await db.from('stats').upsert({
      user_id: user.id,
      xp: Math.max(cur?.xp ?? 0, num(s.xp, 0, 1e9, 0)),
      streak: Math.max(cur?.streak ?? 0, num(s.streak, 0, 10000, 0)),
      best_combo: Math.max(cur?.best_combo ?? 0, num(s.bestCombo ?? s.best_combo, 0, 10000, 0)),
      updated_at: new Date().toISOString(),
    });
    return json({ imported: rows.length, skipped: list.length - rows.length });
  }

  if (m === 'GET' && path === '/me') return json({ user });

  if (m === 'POST' && path === '/logout') {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    await db.from('sessions').delete().eq('token_hash', await sha256(token));
    return json({ ok: true });
  }

  // 계정 삭제: 본인 확인을 위해 비밀번호를 다시 받음. 카드·기록·세션은 함께 지워짐
  if (m === 'DELETE' && path === '/me') {
    // 한글 비밀번호도 되도록 헤더가 아닌 본문으로 받음
    const password = String((await req.json().catch(() => ({}))).password ?? '');
    const { data } = await db.from('users').select('pass_hash').eq('id', user.id).single();
    if (!data || !(await verifyPassword(password, data.pass_hash))) throw new HttpError(401, '비밀번호가 맞지 않아요');
    const { error } = await db.from('users').delete().eq('id', user.id);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true });
  }

  // 관리자: 사람 추가 (회사 공유용)
  if (m === 'POST' && path === '/users') {
    if (!user.is_admin) throw new HttpError(403, '관리자만 사람을 추가할 수 있어요');
    const b = await body();
    const name = validName(b.name), password = validPassword(b.password);
    const { data, error } = await db.from('users').insert({ name, pass_hash: await hashPassword(password) }).select('id, name, is_admin').single();
    if (error) throw new HttpError(error.code === '23505' ? 409 : 500, error.code === '23505' ? '이미 있는 이름이에요' : error.message);
    await db.from('stats').insert({ user_id: data.id });
    return json({ user: data }, 201);
  }

  // ── Gemini
  if (m === 'GET' && path === '/ai/models') {
    if (!user.is_admin) throw new HttpError(403, '관리자만 볼 수 있어요');
    return json({ models: await listModels() });
  }
  if (m === 'POST' && path === '/ai/probe') {
    if (!user.is_admin) throw new HttpError(403, '관리자만 쓸 수 있어요');
    const b = await body();
    return json(await probe(String(b.model), b.kind === 'tts' ? 'tts' : 'text'));
  }
  if (parts[0] === 'ai' || path === '/tts') await loadModelConfig();
  if (m === 'POST' && path === '/ai/express') {
    const ko = String((await body()).ko ?? '').trim();
    if (!ko) throw new HttpError(400, '한국어 문장을 입력해 주세요');
    if (ko.length > 500) throw new HttpError(400, '500자 이내로 입력해 주세요');
    return json(await express(ko));
  }
  if (m === 'POST' && path === '/ai/word') {
    const b = await body();
    const word = String(b.word ?? '').trim().slice(0, 60), sentence = String(b.sentence ?? '').slice(0, 500);
    if (!word) throw new HttpError(400, '단어가 필요해요');
    return json(await lookup(word, sentence));
  }
  if (m === 'POST' && path === '/ai/transcribe') {
    const b = await body();
    const audio = String(b.audio ?? ''), mime = String(b.mime ?? 'audio/webm').split(';')[0];
    if (!audio) throw new HttpError(400, '녹음이 비어 있어요');
    if (audio.length > 8_000_000) throw new HttpError(400, '녹음이 너무 길어요 (1분 이내로)');
    return json(await transcribe(audio, mime, b.lang === 'en' ? 'en' : 'ko'));
  }
  // 영어 음성: 문장마다 한 번만 만들어 저장소에 두고, 이후엔 저장된 파일 주소를 돌려줌
  if (m === 'POST' && path === '/tts') {
    const text = String((await body()).text ?? '').trim().slice(0, 500);
    if (!text) throw new HttpError(400, '문장이 필요해요');
    const id = await sha256(`${VOICE}|${text}`);
    const { data: hit } = await db.from('audio_cache').select('path').eq('id', id).maybeSingle();
    const publicUrl = (p: string) => db.storage.from('audio').getPublicUrl(p).data.publicUrl;
    if (hit) return json({ url: publicUrl(hit.path), cached: true });
    const { wav, model } = await speak(text);
    const path = `${id}.wav`;
    const up = await db.storage.from('audio').upload(path, wav, { contentType: 'audio/wav', upsert: true, cacheControl: '31536000' });
    if (up.error) throw new HttpError(500, `음성 저장 실패: ${up.error.message}`);
    await db.from('audio_cache').upsert({ id, path, model });
    return json({ url: publicUrl(path), cached: false, model });
  }

  // 카드 목록
  if (m === 'GET' && path === '/cards') {
    const { data, error } = await db.from('cards').select(CARD_COLS).eq('user_id', user.id).is('deleted_at', null).order('created_at');
    if (error) throw new HttpError(500, error.message);
    return json({ cards: data.map(toCard) });
  }

  // 카드 만들기
  if (m === 'POST' && path === '/cards') {
    const b = await body();
    const ko = String(b.ko ?? '').trim(), en = String(b.en ?? '').trim();
    if (!ko || !en) throw new HttpError(400, '한국어와 영어 표현이 모두 필요해요');
    const row = {
      user_id: user.id, ko: ko.slice(0, 500), en: en.slice(0, 500),
      alts: asStrArray(b.alts, 3), note: String(b.note ?? '').slice(0, 1000), words: asWords(b.words),
      stage: 0, due: new Date(firstDue()).toISOString(), listens: Math.max(0, Math.min(Number(b.listens) || 0, 100)),
    };
    const { data, error } = await db.from('cards').insert(row).select(CARD_COLS).single();
    if (error) throw new HttpError(500, error.message);
    return json({ card: toCard(data), first_listens: FIRST_LISTENS }, 201);
  }

  // 카드 하나: /cards/:id, /cards/:id/review, /cards/:id/listen, /cards/:id/words
  if (parts[0] === 'cards' && parts[1]) {
    const id = parts[1];
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, '카드 번호가 올바르지 않아요');
    const card = await getOwnCard(user.id, id);
    const save = async (patch: Record<string, unknown>) => {
      const { data, error } = await db.from('cards').update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', user.id).select(CARD_COLS).single();
      if (error) throw new HttpError(500, error.message);
      return toCard(data);
    };

    if (m === 'DELETE' && parts.length === 2) {
      await save({ deleted_at: new Date().toISOString() });
      return json({ ok: true });
    }
    // 복습 채점 → 서버가 다음 복습 시각 계산. 이번에 들을 횟수도 알려줌
    if (m === 'POST' && parts[2] === 'review') {
      const b = await body();
      const grade = b.grade as Grade;
      if (!['again', 'hard', 'good'].includes(grade)) throw new HttpError(400, '채점 값이 올바르지 않아요');
      const next = schedule({ stage: card.stage, reviews: card.reviews, lapses: card.lapses }, grade);
      const listen_now = listensThisReview(card.listens, card.stage);
      const heard = Math.max(0, Math.min(Number(b.listened) || 0, 50)); // 이번 복습에서 들은 횟수 (한 번에 저장)
      const updated = await save({ stage: next.stage, reviews: next.reviews, lapses: next.lapses, due: new Date(next.due).toISOString(), listens: card.listens + heard });
      return json({ card: updated, listen_now });
    }
    // 들은 횟수 더하기
    if (m === 'POST' && parts[2] === 'listen') {
      const b = await body();
      const add = Math.max(0, Math.min(Number(b.count) || 0, 50));
      return json({ card: await save({ listens: card.listens + add }) });
    }
    // 단어 뜻 추가 (사전에서 찾은 단어를 카드에 저장)
    if (m === 'POST' && parts[2] === 'words') {
      const b = await body();
      const merged = asWords([...(card.words as unknown[]), ...asWords(b.words)]);
      return json({ card: await save({ words: merged }) });
    }
  }

  // 학습 기록 (XP·연속일 등). 허용된 칸만 저장
  if (path === '/stats') {
    if (m === 'GET') {
      const { data } = await db.from('stats').select('*').eq('user_id', user.id).maybeSingle();
      return json({ stats: data ?? (await db.from('stats').insert({ user_id: user.id }).select('*').single()).data });
    }
    if (m === 'PUT') {
      const b = await body();
      const allowed: Record<string, unknown> = {};
      for (const k of ['xp', 'streak', 'best_combo']) if (Number.isFinite(Number(b[k]))) allowed[k] = Math.max(0, Math.floor(Number(b[k])));
      if (b.last_study_day && /^\d{4}-\d{2}-\d{2}$/.test(b.last_study_day)) allowed.last_study_day = b.last_study_day;
      for (const k of ['day', 'totals']) if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) allowed[k] = b[k];
      if (Array.isArray(b.badges)) allowed.badges = asStrArray(b.badges, 100);
      if (typeof b.pet_name === 'string' && b.pet_name.trim()) allowed.pet_name = b.pet_name.trim().slice(0, 10);
      const { data, error } = await db.from('stats').upsert({ user_id: user.id, ...allowed, updated_at: new Date().toISOString() }).select('*').single();
      if (error) throw new HttpError(500, error.message);
      return json({ stats: data });
    }
  }

  throw new HttpError(404, `없는 기능이에요 (${m} ${path})`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    return await route(req);
  } catch (e) {
    if (e instanceof HttpError || e instanceof AiError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: '서버 오류가 났어요. 잠시 후 다시 시도해 주세요' }, 500);
  }
});
