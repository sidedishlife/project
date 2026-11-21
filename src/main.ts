// Study: 한국어 → 자연스러운 영어 표현 → 망각곡선 복습. 모든 기록은 서버(DB)에 저장
// 디자인은 최소한으로 두고 기능부터 확인하는 버전
import './style.css';
import { api, ApiError, hasToken, setToken, setOnUnauthorized, type Card, type Expression, type Grade, type User, type Word, type Stats } from './api';
import { unlockAudio, playTimes, stopAudio, prefetchVoice, getRate, setRate } from './audio';
import { pushState, enablePush, disablePush } from './push';
import { recordingSupported, startRecording, stopAndTranscribe, cancelRecording } from './recorder';
import { listensThisReview, FIRST_LISTENS, LISTEN_TARGET, MASTERED_STAGE } from '../supabase/functions/api/srs';

const app = document.getElementById('app')!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// ───────── 상태
let me: User | null = null;
let cards: Card[] = [];
let stats: Stats | null = null;
type Screen = 'loading' | 'setup' | 'login' | 'home' | 'create' | 'review' | 'list' | 'detail' | 'settings';
let screen: Screen = 'loading';
let busy = ''; // 진행 중 작업 안내 문구

// 만들기 화면
const create = { ko: '', result: null as Expression | null, heard: 0, saved: null as Card | null, playing: false, recording: false };
// 복습 화면
const review = { queue: [] as Card[], i: 0, revealed: false, heard: 0, target: 0, playing: false, done: 0 };
let detailId = '';
let pushOn = false, pushCan = false, pushNote = '';
async function refreshPush() {
  const st = await pushState();
  pushOn = st.on; pushCan = st.can; pushNote = st.note;
}

// ───────── 공통
function toast(msg: string, ms = 3500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
async function run<T>(label: string, f: () => Promise<T>): Promise<T | undefined> {
  busy = label; render();
  try { return await f(); } catch (e) { toast(errMsg(e)); return undefined; } finally { busy = ''; render(); }
}
const now = () => Date.now();
const dueCards = () => cards.filter((c) => c.due <= now()).sort((a, b) => a.due - b.due);
function when(ms: number) {
  const d = ms - now();
  if (d <= 0) return '지금';
  const m = Math.round(d / 60000);
  if (m < 60) return `${m}분 뒤`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 뒤`;
  return `${Math.round(h / 24)}일 뒤`;
}
const kstDay = (t = now()) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);

/** 공부한 날 기록 (연속일·경험치) */
async function touchStudy(xp: number) {
  if (!stats) return;
  const today = kstDay();
  const yesterday = kstDay(now() - 86400_000);
  const streak = stats.last_study_day === today ? stats.streak : stats.last_study_day === yesterday ? stats.streak + 1 : 1;
  stats = { ...stats, xp: stats.xp + xp, streak, last_study_day: today };
  api.saveStats({ xp: stats.xp, streak, last_study_day: today }).catch(() => {});
}

// 영어 문장을 단어 단위로 눌러볼 수 있게
function tappable(en: string) {
  return esc(en).replace(/[A-Za-z][A-Za-z'’-]*/g, (w) => `<span class="w" data-word="${w}">${w}</span>`);
}

// ───────── 화면 그리기
function render() {
  let html = '';
  if (screen === 'loading') html = `<p class="center muted">불러오는 중…</p>`;
  else if (screen === 'setup' || screen === 'login') html = authView();
  else {
    html = `<header><b>Study</b><span class="muted">${esc(me?.name)}${stats ? ` · 🔥${stats.streak}일 · ${stats.xp}XP` : ''}</span></header>`;
    html += ({ home: homeView, create: createView, review: reviewView, list: listView, detail: detailView, settings: settingsView } as Record<string, () => string>)[screen]();
    html += `<nav>
      <button data-go="home" class="${screen === 'home' ? 'on' : ''}">홈</button>
      <button data-go="create" class="${screen === 'create' ? 'on' : ''}">만들기</button>
      <button data-go="review" class="${screen === 'review' ? 'on' : ''}">복습 ${dueCards().length || ''}</button>
      <button data-go="list" class="${screen === 'list' || screen === 'detail' ? 'on' : ''}">카드</button>
      <button data-go="settings" class="${screen === 'settings' ? 'on' : ''}">설정</button>
    </nav>`;
  }
  if (busy) html += `<div class="busy"><div>${esc(busy)}</div></div>`;
  app.innerHTML = html;
}

function authView() {
  const setup = screen === 'setup';
  return `<main class="auth">
    <h1>Study</h1>
    <p class="muted">${setup ? '처음 설정이에요. 관리자 이름과 비밀번호를 정해 주세요.<br>(나중에 동료 계정을 추가할 수 있어요)' : '로그인해 주세요'}</p>
    <form id="auth">
      <input name="name" placeholder="이름" autocomplete="username" required>
      <input name="password" type="password" placeholder="비밀번호 (6자 이상)" autocomplete="${setup ? 'new-password' : 'current-password'}" required minlength="6">
      <button class="primary">${setup ? '시작하기' : '로그인'}</button>
    </form>
  </main>`;
}

function homeView() {
  const due = dueCards().length;
  const mastered = cards.filter((c) => c.stage >= MASTERED_STAGE).length;
  const next = cards.filter((c) => c.due > now()).sort((a, b) => a.due - b.due)[0];
  return `<main>
    <section class="box">
      <div class="big">${due}</div><div>지금 복습할 카드</div>
      ${due ? `<button class="primary" data-go="review">복습 시작</button>` : `<p class="muted">${next ? `다음 복습: ${when(next.due)}` : '아직 카드가 없어요'}</p>`}
    </section>
    <section class="box"><button class="primary" data-go="create">＋ 새 표현 만들기</button></section>
    <section class="row3">
      <div><b>${cards.length}</b><span>전체 카드</span></div>
      <div><b>${mastered}</b><span>마스터</span></div>
      <div><b>${stats?.streak ?? 0}일</b><span>연속 공부</span></div>
    </section>
  </main>`;
}

function rateButtons() {
  const r = getRate();
  return `<div class="rate">속도 <button data-rate="0.75" class="${r === 0.75 ? 'on' : ''}">느리게</button><button data-rate="1" class="${r === 1 ? 'on' : ''}">보통</button></div>`;
}

function createView() {
  const r = create.result;
  let html = `<main>
    <label class="muted">영어로 말하고 싶은 한국어</label>
    <textarea id="ko" rows="3" placeholder="예) 내일 회의 시간을 조금 미뤄도 될까요?">${esc(create.ko)}</textarea>
    <div class="btns">
      ${recordingSupported() ? `<button data-act="rec" class="${create.recording ? 'rec' : ''}">${create.recording ? '⏹ 녹음 끝내기' : '🎙️ 말로 입력'}</button>` : ''}
      <button class="primary" data-act="generate">영어로 만들기</button>
    </div>`;
  if (r) {
    const target = FIRST_LISTENS;
    html += `<section class="box result">
      <p class="en">${tappable(r.en)}</p>
      <p class="hint muted">모르는 단어를 누르면 뜻이 나와요</p>
      ${rateButtons()}
      <div class="btns">
        <button data-act="c-play1">🔊 한 번 듣기</button>
        <button class="primary" data-act="c-play">${create.playing ? '⏹ 멈추기' : `🔁 ${target}번 듣기`}</button>
      </div>
      <p class="count">들은 횟수 <b>${create.heard}</b> / ${target} <span class="muted">(복습하며 총 ${LISTEN_TARGET}번)</span></p>
      ${r.alts.length ? `<div class="alts"><div class="muted">다른 표현</div>${r.alts.map((a, i) => `<p><button class="mini" data-act="alt-play" data-i="${i}">🔊</button> ${tappable(a)}</p>`).join('')}</div>` : ''}
      ${r.note_ko ? `<p class="note">💡 ${esc(r.note_ko)}</p>` : ''}
      ${r.words.length ? `<div class="words">${r.words.map((w) => `<div><b>${esc(w.word)}</b> <span class="muted">${esc(w.pos)} ${esc(w.ipa)}</span><br>${esc(w.meaning_ko)}</div>`).join('')}</div>` : ''}
      ${create.saved
        ? `<p class="ok">✅ 저장됐어요. 10분 뒤 첫 복습이 열려요.</p><button data-act="c-new">새 표현 만들기</button>`
        : `<button class="primary wide" data-act="save">저장하고 복습에 넣기</button>`}
    </section>`;
  }
  return html + `</main>`;
}

function reviewView() {
  const c = review.queue[review.i];
  if (!c) {
    const next = cards.filter((x) => x.due > now()).sort((a, b) => a.due - b.due)[0];
    return `<main><section class="box center">
      ${review.done ? `<div class="big">🎉</div><p>${review.done}장 복습 완료!</p>` : `<p>지금 복습할 카드가 없어요</p>`}
      <p class="muted">${next ? `다음 복습: ${when(next.due)}` : ''}</p>
      <button data-go="home">홈으로</button>
    </section></main>`;
  }
  const left = review.queue.length - review.i;
  let html = `<main><p class="muted">남은 카드 ${left}장 · 단계 ${c.stage}/${MASTERED_STAGE} · 누적 듣기 ${c.listens}/${LISTEN_TARGET}</p>
    <section class="box"><div class="muted">이 말을 영어로?</div><p class="ko">${esc(c.ko)}</p>`;
  if (!review.revealed) {
    html += `<p class="muted">먼저 소리 내어 말해 본 뒤 정답을 확인하세요</p><button class="primary wide" data-act="reveal">정답 보기</button>`;
  } else {
    html += `<p class="en">${tappable(c.en)}</p>
      ${rateButtons()}
      <div class="btns">
        <button data-act="r-play">${review.playing ? '⏹ 멈추기' : `🔁 ${review.target}번 듣기`}</button>
      </div>
      <p class="count">이번에 들은 횟수 <b>${review.heard}</b> / ${review.target}</p>
      ${c.note ? `<p class="note">💡 ${esc(c.note)}</p>` : ''}
      <div class="muted">얼마나 기억났나요?</div>
      <div class="grades">
        <button data-grade="again" class="g-again">몰랐음<small>10분 뒤</small></button>
        <button data-grade="hard" class="g-hard">헷갈림<small>${c.stage ? '간격 절반' : '10분 뒤'}</small></button>
        <button data-grade="good" class="g-good">알았음<small>다음 단계</small></button>
      </div>`;
  }
  return html + `</section></main>`;
}

function listView() {
  if (!cards.length) return `<main><p class="center muted">아직 카드가 없어요</p></main>`;
  const sorted = [...cards].sort((a, b) => b.created_at - a.created_at);
  return `<main><p class="muted">카드 ${cards.length}장</p>${sorted.map((c) => `
    <button class="card-row" data-detail="${c.id}">
      <b>${esc(c.en)}</b><span class="muted">${esc(c.ko)}</span>
      <small>${c.stage >= MASTERED_STAGE ? '⭐ 마스터' : `단계 ${c.stage}/${MASTERED_STAGE}`} · 복습 ${when(c.due)} · 듣기 ${Math.min(c.listens, LISTEN_TARGET)}/${LISTEN_TARGET}</small>
    </button>`).join('')}</main>`;
}

function detailView() {
  const c = cards.find((x) => x.id === detailId);
  if (!c) return `<main><p>카드를 찾을 수 없어요</p></main>`;
  return `<main><button data-go="list">← 목록</button>
    <section class="box">
      <p class="ko">${esc(c.ko)}</p>
      <p class="en">${tappable(c.en)}</p>
      ${rateButtons()}
      <div class="btns"><button data-act="d-play">🔊 듣기</button></div>
      ${c.alts.length ? `<div class="alts"><div class="muted">다른 표현</div>${c.alts.map((a) => `<p>${tappable(a)}</p>`).join('')}</div>` : ''}
      ${c.note ? `<p class="note">💡 ${esc(c.note)}</p>` : ''}
      ${c.words.length ? `<div class="words">${c.words.map((w) => `<div><b>${esc(w.word)}</b> <span class="muted">${esc(w.pos)} ${esc(w.ipa)}</span><br>${esc(w.meaning_ko)}</div>`).join('')}</div>` : ''}
      <p class="muted">단계 ${c.stage}/${MASTERED_STAGE} · 다음 복습 ${when(c.due)} · 누적 듣기 ${c.listens}회 · 잊은 횟수 ${c.lapses}</p>
      <button class="danger" data-act="delete">카드 삭제</button>
    </section></main>`;
}

function settingsView() {
  return `<main>
    <section class="box"><b>${esc(me?.name)}</b> ${me?.is_admin ? '(관리자)' : ''}</section>
    ${me?.is_admin ? `<section class="box"><b>동료 계정 추가</b>
      <form id="add-user"><input name="name" placeholder="이름" required><input name="password" type="password" placeholder="임시 비밀번호 (6자 이상)" minlength="6" required><button>추가</button></form></section>` : ''}
    <section class="box"><b>저녁 9시 복습 알림</b>
      <p class="muted">${esc(pushNote)}</p>
      ${pushOn ? `<div class="btns"><button data-act="push-test">알림 시험</button><button data-act="push-off">끄기</button></div>` : pushCan ? `<button class="primary" data-act="push-on">알림 켜기</button>` : ''}
    </section>
    <section class="box"><b>예전 앱 기록 가져오기</b>
      <p class="muted">예전 앱 설정 → 내보내기로 받은 백업 파일(.json)을 고르세요. 같은 문장은 건너뛰고, 복습 단계와 들은 횟수는 그대로 옮겨요.</p>
      <label class="filebtn">백업 파일 고르기<input id="import" type="file" accept="application/json,.json" hidden></label>
    </section>
    <section class="box"><button data-act="logout">로그아웃</button></section>
  </main>`;
}

// ───────── 단어 뜻 보기
async function showWord(token: string, sentence: string, card: Card | null, known: Word[]) {
  const t = token.toLowerCase().replace(/[’']s$/, '');
  const hit = known.find((w) => [w.word, w.lemma].some((x) => x.toLowerCase() === t) || w.word.toLowerCase().split(/\s+/).includes(t));
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const show = (w: Word) => {
    sheet.innerHTML = `<div class="sheet-in"><b class="sw">${esc(w.word)}</b> <span class="muted">${esc(w.pos)} ${esc(w.ipa)}</span>
      <p class="meaning">${esc(w.meaning_ko)}</p>${w.example_en ? `<p class="muted">예) ${esc(w.example_en)}</p>` : ''}
      <button data-close>닫기</button></div>`;
  };
  sheet.addEventListener('click', (e) => { if (e.target === sheet || (e.target as HTMLElement).closest('[data-close]')) sheet.remove(); });
  document.body.appendChild(sheet);
  if (hit) return show(hit);
  sheet.innerHTML = `<div class="sheet-in"><b>${esc(token)}</b><p class="muted">뜻 찾는 중…</p></div>`;
  try {
    const w = await api.word(token, sentence);
    show(w);
    if (card) {
      const updated = await api.addWords(card.id, [w]);
      cards = cards.map((c) => (c.id === updated.id ? updated : c));
      review.queue = review.queue.map((c) => (c.id === updated.id ? updated : c));
    } else if (create.result) create.result.words.push(w);
  } catch (e) {
    sheet.innerHTML = `<div class="sheet-in"><b>${esc(token)}</b><p>${esc(errMsg(e))}</p><button data-close>닫기</button></div>`;
  }
}

// ───────── 동작
async function loadAll() {
  [cards, stats] = await Promise.all([api.cards(), api.stats()]);
}

async function start() {
  setOnUnauthorized(() => { me = null; screen = 'login'; render(); toast('다시 로그인해 주세요'); });
  render();
  try {
    if (hasToken()) {
      me = (await api.me()).user;
      await loadAll();
      screen = 'home';
    } else {
      screen = (await api.status()).setup_needed ? 'setup' : 'login';
    }
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) { app.innerHTML = `<p class="center">${esc(errMsg(e))}<br><button onclick="location.reload()">다시 시도</button></p>`; return; }
    screen = 'login';
  }
  render();
}

function go(s: Screen) {
  stopAudio();
  if (create.recording) { cancelRecording(); create.recording = false; }
  if (s === 'review') { review.queue = dueCards(); review.i = 0; review.revealed = false; review.done = 0; review.heard = 0; }
  screen = s;
  render();
  window.scrollTo(0, 0);
  if (s === 'settings') refreshPush().then(render);
}

async function generate() {
  const ko = (document.getElementById('ko') as HTMLTextAreaElement).value.trim();
  if (!ko) return toast('한국어 문장을 입력해 주세요');
  create.ko = ko;
  const r = await run('영어 표현을 만드는 중…', () => api.express(ko));
  if (!r) return;
  create.result = r; create.heard = 0; create.saved = null;
  render();
  prefetchVoice(r.en); // 듣기 누르기 전에 음성을 미리 만들어 둠
}

async function createPlay(times: number) {
  const r = create.result!;
  if (create.playing) { stopAudio(); create.playing = false; render(); return; }
  create.playing = true; render();
  try {
    const before = create.heard;
    const heard = await playTimes(r.en, times, (n) => { create.heard = before + n; updateCount(`${create.heard}`); });
    if (create.saved && heard) {
      const updated = await api.listen(create.saved.id, heard);
      cards = cards.map((c) => (c.id === updated.id ? updated : c));
    }
  } catch (e) { toast(errMsg(e)); }
  create.playing = false; render();
}

function updateCount(text: string) {
  const b = document.querySelector('.count b');
  if (b) b.textContent = text;
}

async function save() {
  const r = create.result!;
  const card = await run('저장하는 중…', () => api.createCard({ ko: create.ko, en: r.en, alts: r.alts, note: r.note_ko, words: r.words, listens: create.heard }));
  if (!card) return;
  cards.push(card);
  create.saved = card;
  await touchStudy(20);
  render();
}

async function reveal() {
  const c = review.queue[review.i];
  review.revealed = true;
  review.heard = 0;
  review.target = listensThisReview(c.listens, c.stage);
  render();
  reviewPlay(); // 정답을 열면 바로 정해진 횟수만큼 들려줌
}

async function reviewPlay() {
  const c = review.queue[review.i];
  if (review.playing) { stopAudio(); review.playing = false; render(); return; }
  const remain = Math.max(1, review.target - review.heard);
  review.playing = true; render();
  try {
    const before = review.heard;
    await playTimes(c.en, remain, (n) => { review.heard = before + n; updateCount(`${review.heard}`); });
  } catch (e) { toast(errMsg(e)); }
  review.playing = false; render();
}

async function grade(g: Grade) {
  const c = review.queue[review.i];
  stopAudio(); review.playing = false;
  const r = await run('저장하는 중…', async () => (await api.review(c.id, g, review.heard)).card);
  if (!r) return;
  cards = cards.map((x) => (x.id === r.id ? r : x));
  review.done++;
  await touchStudy(g === 'good' ? 10 : g === 'hard' ? 5 : 2);
  review.i++; review.revealed = false; review.heard = 0;
  // 몰랐음 카드는 10분 뒤에 다시 나오므로 이번 줄에서는 빼고 넘어감
  render();
  const next = review.queue[review.i];
  if (next) prefetchVoice(next.en);
}

async function toggleRecord() {
  if (!create.recording) {
    try {
      await startRecording(60_000, () => toggleRecord());
      create.recording = true; render();
    } catch (e) { toast(errMsg(e)); }
    return;
  }
  create.recording = false;
  const text = await run('말한 내용을 글자로 바꾸는 중…', () => stopAndTranscribe());
  if (text) { create.ko = text; render(); }
}

// 첫 터치 때 오디오를 깨워 둠 (아이폰)
document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('touchend', unlockAudio, { capture: true });

app.addEventListener('change', async (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id !== 'import' || !t.files?.[0]) return;
  try {
    const data = JSON.parse(await t.files[0].text());
    if (!Array.isArray(data.cards)) throw new Error('예전 앱의 백업 파일이 아니에요');
    const r = await run(`카드 ${data.cards.length}장 가져오는 중…`, () => api.importBackup(data.cards, data.stats ?? {}));
    if (r) { await loadAll(); toast(`${r.imported}장 가져왔어요${r.skipped ? ` (이미 있는 ${r.skipped}장은 건너뜀)` : ''}`); render(); }
  } catch (err) { toast(err instanceof SyntaxError ? '파일을 읽지 못했어요 (.json 백업 파일인지 확인해 주세요)' : errMsg(err)); }
  t.value = '';
});

app.addEventListener('input', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'ko') create.ko = (t as HTMLTextAreaElement).value;
});

app.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement).closest('button, .w') as HTMLElement | null;
  if (!el) return;
  const d = el.dataset;
  if (d.go) return go(d.go as Screen);
  if (d.rate) { setRate(Number(d.rate)); render(); return; }
  if (d.word) {
    const sentence = el.closest('p')?.textContent ?? '';
    if (screen === 'create' && create.result) return showWord(d.word, sentence, create.saved, create.result.words);
    const c = screen === 'review' ? review.queue[review.i] : cards.find((x) => x.id === detailId);
    if (c) return showWord(d.word, sentence, c, c.words);
    return;
  }
  if (d.detail) { detailId = d.detail; return go('detail'); }
  if (d.grade) return grade(d.grade as Grade);
  switch (d.act) {
    case 'generate': return generate();
    case 'rec': return toggleRecord();
    case 'c-play': return createPlay(FIRST_LISTENS);
    case 'c-play1': return createPlay(1);
    case 'alt-play': {
      const a = create.result?.alts[Number(d.i)];
      if (a) playTimes(a, 1).catch((err) => toast(errMsg(err)));
      return;
    }
    case 'c-new': create.ko = ''; create.result = null; create.saved = null; create.heard = 0; return render();
    case 'save': return save();
    case 'reveal': return reveal();
    case 'r-play': return reviewPlay();
    case 'd-play': {
      const c = cards.find((x) => x.id === detailId);
      if (c) playTimes(c.en, 1).catch((err) => toast(errMsg(err)));
      return;
    }
    case 'delete': {
      if (!confirm('이 카드를 삭제할까요?')) return;
      const ok = await run('삭제하는 중…', () => api.deleteCard(detailId));
      if (ok) { cards = cards.filter((c) => c.id !== detailId); go('list'); }
      return;
    }
    case 'push-on': {
      const ok = await run('알림을 켜는 중…', enablePush);
      if (ok) toast('알림을 켰어요. 매일 저녁 9시에 복습할 카드가 있으면 알려 드려요');
      await refreshPush(); return render();
    }
    case 'push-off': await run('알림을 끄는 중…', disablePush); await refreshPush(); return render();
    case 'push-test': {
      const r = await run('알림을 보내는 중…', api.pushTest);
      if (r) toast(r.sent ? `알림을 보냈어요 (${r.sent}대). 몇 초 안에 와야 정상이에요` : `보내지 못했어요 ${r.failed.join(' ') || '(등록된 기기 없음)'}`);
      return;
    }
    case 'logout':
      await api.logout().catch(() => {});
      setToken(''); me = null; cards = []; stats = null;
      screen = 'login'; return render();
  }
});

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const name = (f.elements.namedItem('name') as HTMLInputElement).value.trim();
  const password = (f.elements.namedItem('password') as HTMLInputElement).value;
  if (f.id === 'auth') {
    const r = await run(screen === 'setup' ? '설정하는 중…' : '로그인하는 중…', () => (screen === 'setup' ? api.setup(name, password) : api.login(name, password)));
    if (!r) return;
    setToken(r.token); me = r.user;
    await run('불러오는 중…', loadAll);
    go('home');
  }
  if (f.id === 'add-user') {
    const r = await run('추가하는 중…', () => api.addUser(name, password));
    if (r) { toast(`${r.user.name} 계정을 만들었어요. 이름과 비밀번호를 전달해 주세요`); f.reset(); }
  }
});

// 앱을 다시 열었을 때 복습할 카드 수를 새로 계산
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && me && (screen === 'home' || screen === 'list')) loadAll().then(render).catch(() => {});
});

if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => {});

start();
