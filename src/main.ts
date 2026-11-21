// 영어 모험: 한국어 → 자연스러운 영어 표현(주문) → 망각곡선 복습(모험). 모든 기록은 서버(DB)에 저장
// 화면: 마을(홈) / 주문 배우기(만들기) / 모험(복습) / 도감(카드), 설정은 오른쪽 위 톱니바퀴
import './style.css';
import { api, ApiError, hasToken, setToken, setOnUnauthorized, type Card, type Expression, type Grade, type User, type Word, type Stats } from './api';
import { unlockAudio, playTimes, stopAudio, prefetchVoice, getRate, setRate } from './audio';
import { pushState, enablePush, disablePush } from './push';
import { recordingSupported, startRecording, stopAndTranscribe, cancelRecording } from './recorder';
import { MASTERED_STAGE } from '../supabase/functions/api/srs';
import { XP, levelOf, regionOf, tierOf, ALL_TIERS, QUESTS, REGIONS, BADGES, emptyDay, emptyTotals, needFor, type Day, type Totals, type Ctx } from './game';
import { compare, hintOf, type SpeakResult } from './speak';
import { heroImg, castImg, faceImg, faceUrl, monsterImg, sceneBg, preloadArt, type Face } from './art';

const app = document.getElementById('app')!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// ───────── 상태
let me: User | null = null;
let cards: Card[] = [];
let stats: Stats | null = null;
type Screen = 'loading' | 'setup' | 'login' | 'home' | 'create' | 'review' | 'list' | 'detail' | 'settings' | 'hero';
let screen: Screen = 'loading';
let busy = '';

const create = { ko: '', result: null as Expression | null, heard: 0, saved: null as Card | null, playing: false, recording: false };
const review = { queue: [] as Card[], i: 0, revealed: false, heard: 0, target: 0, playing: false, done: 0, combo: 0, xp: 0, hit: false, hint: false };
// 말하기 채점 (모험·도감·주문 배우기 공용)
const speakSt = { key: '', recording: false, result: null as SpeakResult | null };
const speakRewarded = new Set<string>(); // 같은 주문으로 보상은 하루 한 번
let detailId = '';
let tierFilter = '';
let repeat = 20;
try { repeat = Number(localStorage.getItem('study.repeat')) || 20; } catch { /* 무시 */ }
const REVIEW_AUTO = 3;
let pushOn = false, pushCan = false, pushNote = '';
async function refreshPush() { const st = await pushState(); pushOn = st.on; pushCan = st.can; pushNote = st.note; }

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
function today(): Day {
  const d = stats?.day as Day | undefined;
  return d && d.date === kstDay() ? d : emptyDay(kstDay());
}
const level = () => levelOf(stats?.xp ?? 0);

// ───────── 경험치·퀘스트
/** 경험치를 주고, 레벨이 오르면 축하 창을 띄움. 오늘 기록(day)도 함께 저장 */
function totals(): Totals { return { ...emptyTotals(), ...(stats?.totals ?? {}) }; }
function ctx(t = totals()): Ctx {
  return { cards: cards.length, mastered: cards.filter((c) => c.stage >= MASTERED_STAGE).length, gold: cards.filter((c) => c.stage >= 4).length, streak: stats?.streak ?? 0, combo: Math.max(stats?.best_combo ?? 0, review.combo), t };
}
function gain(xp: number, change: (d: Day) => void = () => {}, changeT: (t: Totals) => void = () => {}) {
  if (!stats) return;
  const before = level().lv;
  const d = today();
  change(d);
  const tt = totals();
  changeT(tt);
  // 하루 첫 공부: 연속일 갱신 + 연속 보너스
  const t = kstDay(), y = kstDay(now() - 86400_000);
  let streak = stats.streak;
  if (!d.firstStudy) {
    d.firstStudy = true;
    streak = stats.last_study_day === t ? stats.streak : stats.last_study_day === y ? stats.streak + 1 : 1;
    xp += Math.min(streak * XP.streakPerDay, XP.streakMax);
  }
  stats = { ...stats, xp: stats.xp + xp, streak, last_study_day: t, day: d, totals: tt, best_combo: Math.max(stats.best_combo, review.combo) };
  // 새로 달성한 업적: 보상 경험치 + 알림
  const owned = new Set(stats.badges ?? []);
  const fresh = BADGES.filter((b) => !owned.has(b.id) && b.done(ctx(tt)));
  if (fresh.length) {
    stats.badges = [...owned, ...fresh.map((b) => b.id)];
    stats.xp += fresh.reduce((a, b) => a + b.xp, 0);
    fresh.forEach((b, i) => setTimeout(() => toast(`🏆 업적 달성: ${b.icon} ${b.name} (+${b.xp} XP)`, 4000), 600 + i * 1500));
  }
  api.saveStats({ xp: stats.xp, streak, last_study_day: t, day: d, totals: tt, badges: stats.badges ?? [], best_combo: stats.best_combo }).catch(() => {});
  const after = level().lv;
  if (after > before) setTimeout(() => levelUp(before, after), 300);
}

function levelUp(from: number, to: number) {
  const r1 = regionOf(from), r2 = regionOf(to);
  const pop = document.createElement('div');
  pop.className = 'modal';
  pop.innerHTML = `<div class="panel pop">
    <div class="ribbon">LEVEL UP!</div>
    <div class="pop-hero">${faceImg('happy', 'pop-face')}</div>
    <p class="lvbig">Lv.${from} → <b>Lv.${to}</b></p>
    ${r1 !== r2 ? `<p class="unlock">🗺️ 새 지역 <b>${r2.name}</b>이 열렸어요!<br>새 칭호: <b>${r2.title}</b></p>` : `<p class="muted">다음 지역까지 조금만 더!</p>`}
    <button class="btn gold" data-close>계속하기</button></div>`;
  pop.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-close]')) pop.remove(); });
  document.body.appendChild(pop);
}

/** 받은 경험치가 위로 떠오르는 효과 */
function floatXP(text: string) {
  const f = document.createElement('div');
  f.className = 'float-xp';
  f.textContent = text;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1300);
}

/** 퀘스트를 누르면 그 퀘스트를 할 수 있는 곳으로 */
function goQuest(id: string) {
  const q = QUESTS.find((x) => x.id === id);
  if (!q) return;
  if (q.go === 'create') return go('create');
  if (q.go === 'review') return dueCards().length ? go('review') : (toast('지금은 나타난 몬스터가 없어요. 새 주문을 배워 두면 10분 뒤 나타나요'), go('create'));
  // 말하기: 몬스터가 있으면 모험에서, 없으면 아직 약한 주문을 골라 연습
  if (dueCards().length) return go('review');
  const weak = [...cards].sort((a, b) => a.stage - b.stage || a.due - b.due)[0];
  if (!weak) { toast('먼저 주문을 하나 배워 주세요'); return go('create'); }
  detailId = weak.id;
  toast('이 주문을 🎙️ 말해서 연습해 보세요');
  go('detail');
}

function claimQuest(id: string) {
  const q = QUESTS.find((x) => x.id === id);
  const d = today();
  if (!q || d.claimed.includes(id) || q.progress(d) < q.goal) return;
  gain(q.xp, (dd) => { dd.claimed.push(id); });
  toast(`퀘스트 보상 +${q.xp} XP`);
  render();
}

// 영어 문장을 단어 단위로 눌러볼 수 있게
function tappable(en: string) {
  return esc(en).replace(/[A-Za-z][A-Za-z'’-]*/g, (w) => `<span class="w" data-word="${w}">${w}</span>`);
}

// ───────── 화면 그리기
function render() {
  let html = '';
  if (screen === 'loading') html = `<div class="center loading">${heroImg('loading-hero')}<p>모험을 준비하는 중…</p></div>`;
  else if (screen === 'setup' || screen === 'login') html = authView();
  else {
    html = hud();
    html += ({ home: homeView, create: createView, review: reviewView, list: listView, detail: detailView, settings: settingsView, hero: heroView } as Record<string, () => string>)[screen]();
    const due = dueCards().length;
    const tab = (s: string, icon: string, label: string, on: boolean, badge = 0) =>
      `<button data-go="${s}" class="${on ? 'on' : ''}"><span class="ti">${icon}</span>${label}${badge ? `<i class="badge">${badge}</i>` : ''}</button>`;
    html += `<nav class="tabs">
      ${tab('home', '🏠', '마을', screen === 'home')}
      ${tab('create', '✨', '주문 배우기', screen === 'create')}
      ${tab('review', '⚔️', '모험', screen === 'review', due)}
      ${tab('list', '📖', '도감', screen === 'list' || screen === 'detail')}
    </nav>`;
  }
  if (busy) html += `<div class="busy"><div class="panel">${esc(busy)}</div></div>`;
  app.innerHTML = html;
}

function hud() {
  const { lv, cur, need } = level();
  const r = regionOf(lv);
  return `<header class="hud">
    <button class="hud-me" data-go="hero" aria-label="모험가 정보">
      <div class="avatar" style="background-image:url(${faceUrl('happy')})"><span class="lv">Lv.${lv}</span></div>
      <div class="who"><b>${esc(me?.name)}</b><small>${r.title} ›</small>
        <div class="xpbar"><i style="width:${Math.round((cur / need) * 100)}%"></i><span>${cur} / ${need} XP</span></div></div>
    </button>
    <div class="streak" title="연속 공부">🔥<b>${stats?.streak ?? 0}</b></div>
    <button class="gear" data-go="settings" aria-label="설정">⚙️</button>
  </header>`;
}

function authView() {
  const setup = screen === 'setup';
  return `<main class="auth">
    <div class="title-banner">영어 모험</div>
    <div class="auth-hero">${heroImg()}</div>
    <div class="panel">
      <p class="dialog">${setup ? '처음 오셨군요! 모험가 이름과 비밀번호를 정해 주세요. (나중에 동료도 초대할 수 있어요)' : '다시 오셨군요! 이름과 비밀번호를 알려 주세요.'}</p>
      <form id="auth">
        <input name="name" placeholder="모험가 이름" autocomplete="username" required>
        <input name="password" type="password" placeholder="비밀번호 (6자 이상)" autocomplete="${setup ? 'new-password' : 'current-password'}" required minlength="6">
        <button class="btn gold">${setup ? '모험 시작하기' : '입장하기'}</button>
      </form>
    </div>
  </main>`;
}

function homeView() {
  const due = dueCards().length;
  const { lv } = level();
  const r = regionOf(lv);
  const next = cards.filter((c) => c.due > now()).sort((a, b) => a.due - b.due)[0];
  const d = today();
  const face: Face = due ? 'wow' : 'happy';
  const line = !cards.length
    ? '첫 주문을 배워 볼까요? 영어로 하고 싶은 말을 한국어로 알려 주세요!'
    : due
      ? `잊어버리기 직전인 주문이 <b>${due}개</b> 있어요! 몬스터가 되기 전에 물리쳐요.`
      : `지금은 나타난 몬스터가 없어요. ${next ? `다음 몬스터는 <b>${when(next.due)}</b>에 나타나요.` : ''} 그동안 새 주문을 배워 둘까요?`;
  const cta = due
    ? `<button class="btn gold big" data-go="review">⚔️ 모험 출발 <small>${due}마리</small></button>`
    : `<button class="btn gold big" data-go="create">✨ 새 주문 배우기</button>`;
  const quests = QUESTS.map((q) => {
    const p = Math.min(q.progress(d), q.goal), done = p >= q.goal, claimed = d.claimed.includes(q.id);
    return `<li class="${claimed ? 'claimed' : ''}" data-quest="${q.id}"><span>${q.icon} ${esc(q.label)}</span><small>${p}/${q.goal}</small>
      ${claimed ? '<em>✔ 완료</em>' : done ? `<button class="btn gold mini" data-claim="${q.id}">보상 +${q.xp}</button>` : `<em class="go">+${q.xp} ›</em>`}</li>`;
  }).join('');
  const mastered = cards.filter((c) => c.stage >= MASTERED_STAGE).length;
  return `<main>
    <section class="stage">
      ${sceneBg(r)}
      <button class="region" data-go="hero">📍 ${r.name} ›</button>
      <div class="stage-hero">${heroImg()}</div>
    </section>
    <section class="dialog-box with-face" data-act="cta">${faceImg(face, 'dlg-face')}<b class="speaker">${esc(me?.name)}</b><p>${line}</p></section>
    ${cta}
    <section class="panel">
      <div class="ribbon">오늘의 퀘스트</div>
      <ul class="quests">${quests}</ul>
      <p class="hint center">퀘스트를 누르면 바로 해당 장소로 이동해요</p>
    </section>
    <section class="row3">
      <button class="panel mini-stat" data-act="dex-all"><b>${cards.length}</b><span>📖 배운 주문 ›</span></button>
      <button class="panel mini-stat" data-act="dex-master"><b>${mastered}</b><span>👑 마스터 ›</span></button>
      <button class="panel mini-stat" data-go="hero"><b>${(stats?.badges ?? []).length}/${BADGES.length}</b><span>🏆 업적 ›</span></button>
    </section>
  </main>`;
}

function rateButtons() {
  const r = getRate();
  const opts: [number, string][] = [[0.9, '느리게'], [1, '보통'], [1.15, '조금 빠르게'], [1.3, '빠르게']];
  return `<div class="rate">${opts.map(([v, l]) => `<button data-rate="${v}" class="chip ${r === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

function wordList(words: Word[]) {
  return words.length ? `<details class="words"><summary>📜 단어 ${words.length}개</summary>${words.map((w) => `<div><b>${esc(w.word)}</b> <span class="muted">${esc(w.pos)} ${esc(w.ipa)}</span><br>${esc(w.meaning_ko)}</div>`).join('')}</details>` : '';
}

function createView() {
  const r = create.result;
  let html = `<main>
    <section class="panel">
      <div class="ribbon">주문 배우기</div>
      <p class="dialog">영어로 하고 싶은 말을 한국어로 알려 주세요. 원어민이 실제로 쓰는 주문으로 바꿔 드릴게요.</p>
      <textarea id="ko" rows="3" placeholder="예) 내일 회의 시간을 조금 미뤄도 될까요?">${esc(create.ko)}</textarea>
      <div class="btns">
        ${recordingSupported() ? `<button class="btn wood" data-act="rec">${create.recording ? '⏹ 녹음 끝내기' : '🎙️ 말로 입력'}</button>` : ''}
        <button class="btn gold" data-act="generate">✨ 주문 만들기</button>
      </div>
    </section>`;
  if (r) {
    html += `<section class="panel result">
      <div class="ribbon">${create.saved ? '배운 주문' : '새 주문'}</div>
      <p class="en">${tappable(r.en)}</p>
      <p class="hint">모르는 단어를 누르면 뜻이 나와요</p>
      ${rateButtons()}
      <div class="btns">
        <button class="btn wood" data-act="c-play1">🔊 한 번</button>
        <button class="btn gold" data-act="c-play">${create.playing ? '⏹ 멈추기' : `🔁 ${repeat}번 듣기`}</button>
      </div>
      <div class="meter"><i style="width:${Math.min(100, (create.heard / repeat) * 100)}%"></i><span class="count">들은 횟수 <b>${create.heard}</b> / ${repeat}</span></div>
      ${r.alts.length ? `<div class="alts"><div class="sub">다른 표현</div>${r.alts.map((a, i) => `<div class="alt"><button class="btn wood mini" data-act="alt-play" data-i="${i}">🔊</button><p>${tappable(a)}</p>${create.saved ? '' : `<button class="btn gold mini" data-act="alt-pick" data-i="${i}">이걸로</button>`}</div>`).join('')}</div>` : ''}
      ${r.note_ko ? `<p class="note">💡 ${esc(r.note_ko)}</p>` : ''}
      ${wordList(r.words)}
      ${create.saved
        ? `<p class="ok">✅ 주문을 배웠어요! 10분 뒤 첫 몬스터로 나타나요.</p>
           ${speakPanel(`c:${create.saved.id}`, '🎙️ 따라 말해 보기')}
           <div class="btns"><button class="btn wood" data-act="c-new">✨ 다른 주문 배우기</button>${dueCards().length ? `<button class="btn wood" data-go="review">⚔️ 모험 (${dueCards().length})</button>` : `<button class="btn wood" data-go="home">🏠 마을로</button>`}</div>`
        : `<button class="btn gold big" data-act="save">📖 도감에 저장 <small>+${XP.create} XP</small></button><button class="btn wood" data-act="generate">🔄 마음에 안 들면 다시 만들기</button>`}
    </section>`;
  }
  return html + `</main>`;
}

function reviewView() {
  const c = review.queue[review.i];
  const { lv } = level();
  const r = regionOf(lv);
  if (!c) {
    const next = cards.filter((x) => x.due > now()).sort((a, b) => a.due - b.due)[0];
    return `<main><section class="panel center">
      <div class="ribbon">${review.done ? '승리!' : '조용한 들판'}</div>
      <div class="pop-hero">${faceImg(review.done ? 'happy' : 'wow', 'pop-face')}</div>
      ${review.done ? `<p class="lvbig">몬스터 <b>${review.done}</b>마리 처치 · <b>+${review.xp}</b> XP</p>` : `<p>지금은 나타난 몬스터가 없어요</p>`}
      <p class="muted">${next ? `다음 몬스터: ${when(next.due)}` : ''}</p>
      <div class="btns col">
        <button class="btn gold" data-go="create">✨ 새 주문 배우기</button>
        <div class="btns"><button class="btn wood" data-go="list">📖 도감</button><button class="btn wood" data-go="home">🏠 마을로</button></div>
      </div>
    </section></main>`;
  }
  const left = review.queue.length - review.i;
  const tier = tierOf(c.stage);
  let html = `<main>
    <section class="battle">
      ${sceneBg(r)}
      <div class="bt-top"><span>남은 몬스터 ${left}</span>${review.combo > 1 ? `<span class="combo">${review.combo} COMBO!</span>` : ''}<span style="color:${tier.color}">${tier.icon} ${tier.name}</span></div>
      <div class="bt-monster"><div class="hp"><i style="width:${review.hit ? 0 : 100}%"></i></div>${monsterImg(c.stage, review.hit)}</div>
      <div class="bt-hero">${review.revealed ? castImg('casting') : heroImg()}</div>
    </section>
    <section class="panel">
      <p class="sub">이 말을 영어로 외쳐 보세요!</p>
      <p class="ko">${esc(c.ko)}</p>`;
  if (!review.revealed) {
    html += `${review.hint ? `<p class="hint-line">💡 ${esc(hintOf(c.en))}</p>` : ''}
      ${speakPanel(`r:${c.id}`, '🎙️ 말해서 공격하기')}
      <div class="btns">
        ${review.hint ? '' : `<button class="btn wood" data-act="hint">💡 힌트 <small>(경험치 절반)</small></button>`}
        <button class="btn wood" data-act="reveal">🔮 정답 보기</button>
      </div>
      <p class="hint center">떠올린 영어를 소리 내어 말하면 정확도로 공격해요</p>`;
  } else {
    const sug = speakSt.key === `r:${c.id}` && speakSt.result ? (speakSt.result.score >= 80 ? 'good' : speakSt.result.score >= 50 ? 'hard' : 'again') : '';
    html += `<p class="en">${tappable(c.en)}</p>
      ${speakSt.key === `r:${c.id}` && speakSt.result ? speakPanel(`r:${c.id}`) : ''}
      ${rateButtons()}
      <div class="btns">
        <button class="btn wood" data-act="r-play">${review.playing ? '⏹ 멈추기' : `🔁 ${REVIEW_AUTO}번 더`}</button>
        ${review.playing ? '' : `<button class="btn wood" data-act="r-play-full">🔁 ${repeat}번</button>`}
      </div>
      <p class="count center">이번에 들은 횟수 <b>${review.heard}</b></p>
      ${c.note ? `<p class="note">💡 ${esc(c.note)}</p>` : ''}
      <p class="sub center">얼마나 기억났나요?</p>
      <div class="grades">
        <button data-grade="again" class="g g-again ${sug === 'again' ? 'suggest' : ''}">💨 몰랐음<small>10분 뒤 다시</small></button>
        <button data-grade="hard" class="g g-hard ${sug === 'hard' ? 'suggest' : ''}">⚔️ 헷갈림<small>공격</small></button>
        <button data-grade="good" class="g g-good ${sug === 'good' ? 'suggest' : ''}">💥 알았음<small>치명타!</small></button>
      </div>`;
  }
  return html + `</section></main>`;
}

/** 🎙️ 말하기 버튼과 채점 결과 */
function speakPanel(key: string, label = '🎙️ 영어로 말해 보기') {
  const mine = speakSt.key === key;
  const rec = mine && speakSt.recording;
  const r = mine ? speakSt.result : null;
  const verdict = r ? (r.score >= 95 ? '🎯 완벽해요!' : r.score >= 80 ? '💥 명중!' : r.score >= 50 ? '⚔️ 거의 다 왔어요' : '💨 빗나갔어요') : '';
  return `<div class="speak">
    <button class="btn ${rec ? 'danger rec-pulse' : 'gold'}" data-speak="${key}">${rec ? '⏹ 다 말했어요 (누르면 채점)' : r ? '🎙️ 다시 말해 보기' : label}</button>
    ${r ? `<div class="speak-res"><b class="score s${r.score >= 80 ? 'ok' : r.score >= 50 ? 'mid' : 'bad'}">${r.score}점</b> <span>${verdict}</span>
      <p class="marks">${r.marks.map((m) => `<span class="${m.ok ? 'hitw' : 'miss'}">${esc(m.w)}</span>`).join(' ')}</p>
      <small class="muted">들린 말: "${esc(r.heard)}"</small></div>` : ''}
  </div>`;
}

function heroView() {
  const { lv, cur, need } = level();
  const r = regionOf(lv);
  const t = totals();
  const c = ctx(t);
  const owned = new Set(stats?.badges ?? []);
  const tierCount = ALL_TIERS.map((x) => ({ ...x, n: cards.filter((cd) => tierOf(cd.stage).key === x.key).length }));
  // 다음 레벨·다음 지역까지
  let toNext = 0; for (let l = lv; l < (REGIONS.find((g) => g.from > lv)?.from ?? lv); l++) toNext += needFor(l);
  toNext -= cur;
  const nextRegion = REGIONS.find((g) => g.from > lv);
  return `<main>
    <section class="stage hero-stage">${sceneBg(r)}<div class="stage-hero">${heroImg()}</div>
      <div class="hero-card"><b>Lv.${lv}</b><span>${esc(me?.name)}</span><small>${r.title}</small></div></section>
    <section class="panel">
      <div class="ribbon">모험가 정보</div>
      <div class="xpbar big"><i style="width:${Math.round((cur / need) * 100)}%"></i><span>다음 레벨까지 ${need - cur} XP</span></div>
      <div class="stat-grid">
        <div><b>${stats?.xp ?? 0}</b><span>누적 XP</span></div><div><b>🔥 ${stats?.streak ?? 0}일</b><span>연속 공부</span></div>
        <div><b>${cards.length}</b><span>배운 주문</span></div><div><b>${t.spoken}</b><span>말해서 공격</span></div>
        <div><b>${t.reviewed}</b><span>몬스터 처치</span></div><div><b>⚡ ${stats?.best_combo ?? 0}</b><span>최고 콤보</span></div>
      </div>
      <div class="tier-row">${tierCount.map((x) => `<button class="chip" data-act="dex-tier" data-t="${x.key}">${x.icon} ${x.n}</button>`).join('')}</div>
    </section>
    <section class="panel">
      <div class="ribbon">모험 지도</div>
      <ol class="map">${REGIONS.map((g) => {
        const open = lv >= g.from, here = g === r;
        return `<li class="${open ? 'open' : 'locked'} ${here ? 'here' : ''}" style="background-image:url(./art/bg-${g.feature}.webp)">
          <span>${open ? '' : '🔒 '}${g.name}</span><small>Lv.${g.from}~ · ${g.title}${here ? ' · 지금 여기' : ''}</small></li>`;
      }).join('')}</ol>
      ${nextRegion ? `<p class="hint center">다음 지역 <b>${nextRegion.name}</b>까지 약 ${toNext} XP</p>` : `<p class="hint center">모든 지역을 열었어요!</p>`}
    </section>
    <section class="panel">
      <div class="ribbon">업적 ${owned.size}/${BADGES.length}</div>
      <div class="badges">${BADGES.map((b) => {
        const has = owned.has(b.id); const now = Math.min(b.now(c), b.goal);
        return `<div class="badge-item ${has ? 'got' : ''}"><span class="bi">${has ? b.icon : '🔒'}</span><b>${b.name}</b><small>${b.desc}</small>
          ${has ? `<em>+${b.xp} XP 받음</em>` : `<div class="mini-bar"><i style="width:${Math.round((now / b.goal) * 100)}%"></i></div><small>${now}/${b.goal}</small>`}</div>`;
      }).join('')}</div>
    </section>
  </main>`;
}

function listView() {
  if (!cards.length) return `<main><section class="panel center"><div class="ribbon">도감</div><p>아직 배운 주문이 없어요</p><button class="btn gold" data-go="create">✨ 첫 주문 배우기</button></section></main>`;
  const counts = Object.fromEntries(ALL_TIERS.map((t) => [t.key, cards.filter((c) => tierOf(c.stage).key === t.key).length]));
  const shown = [...cards].filter((c) => !tierFilter || tierOf(c.stage).key === tierFilter).sort((a, b) => b.created_at - a.created_at);
  return `<main><section class="panel">
    <div class="ribbon">도감 ${cards.length}</div>
    <div class="tiers"><button class="chip ${tierFilter ? '' : 'on'}" data-tier="">전체</button>${ALL_TIERS.map((t) => `<button class="chip ${tierFilter === t.key ? 'on' : ''}" data-tier="${t.key}">${t.icon} ${counts[t.key]}</button>`).join('')}</div>
    <p class="hint">복습할수록 등급이 올라가고, 잊으면 내려가요</p>
    <div class="dex">${shown.map((c) => {
      const t = tierOf(c.stage);
      return `<button class="dex-card" style="--tc:${t.color}" data-detail="${c.id}">
        <span class="dex-tier">${t.icon} ${t.name}</span><b>${esc(c.en)}</b><span class="muted">${esc(c.ko)}</span><small>다음 출현 ${when(c.due)}</small></button>`;
    }).join('')}</div>
  </section></main>`;
}

function detailView() {
  const c = cards.find((x) => x.id === detailId);
  if (!c) return `<main><p>주문을 찾을 수 없어요</p></main>`;
  const t = tierOf(c.stage);
  return `<main><section class="panel" style="--tc:${t.color}">
      <div class="ribbon">${t.icon} ${t.name} 주문</div>
      <p class="ko">${esc(c.ko)}</p>
      <p class="en">${tappable(c.en)}</p>
      ${rateButtons()}
      <div class="btns"><button class="btn wood" data-act="d-play">🔊 한 번</button><button class="btn wood" data-act="d-loop">🔁 ${repeat}번</button></div>
      ${speakPanel(`d:${c.id}`)}
      <button class="btn wood" data-go="list">← 도감으로</button>
      ${c.alts.length ? `<div class="alts"><div class="sub">다른 표현</div>${c.alts.map((a) => `<p>${tappable(a)}</p>`).join('')}</div>` : ''}
      ${c.note ? `<p class="note">💡 ${esc(c.note)}</p>` : ''}
      ${wordList(c.words)}
      <p class="muted">기억 단계 ${c.stage}/${MASTERED_STAGE} · 다음 출현 ${when(c.due)} · 들은 횟수 ${c.listens} · 잊은 횟수 ${c.lapses}</p>
      <button class="btn danger" data-act="delete">주문 지우기</button>
    </section></main>`;
}

function settingsView() {
  return `<main>
    <section class="panel"><div class="ribbon">설정</div>
      <p><b>${esc(me?.name)}</b> ${me?.is_admin ? '(관리자)' : ''} · 누적 ${stats?.xp ?? 0} XP</p>
      <p class="sub">반복 듣기 횟수</p>
      <div class="rate">${[5, 10, 20, 30].map((n) => `<button data-act="set-repeat" data-n="${n}" class="chip ${repeat === n ? 'on' : ''}">${n}번</button>`).join('')}</div>
      <p class="hint">새 주문을 배울 때 이 횟수만큼 이어서 들려줘요. 모험(복습)에서는 정답을 열면 ${REVIEW_AUTO}번 듣고, 원하면 더 들을 수 있어요.</p>
      <p class="sub">저녁 9시 복습 알림</p>
      <p class="hint">${esc(pushNote)}</p>
      ${pushOn ? `<div class="btns"><button class="btn wood" data-act="push-test">알림 시험</button><button class="btn wood" data-act="push-off">끄기</button></div>` : pushCan ? `<button class="btn gold" data-act="push-on">알림 켜기</button>` : ''}
    </section>
    ${me?.is_admin ? `<section class="panel"><div class="ribbon">동료 초대</div>
      <form id="add-user"><input name="name" placeholder="이름" required><input name="password" type="password" placeholder="임시 비밀번호 (6자 이상)" minlength="6" required><button class="btn gold">계정 만들기</button></form></section>` : ''}
    <section class="panel"><div class="ribbon">예전 기록</div>
      <p class="hint">예전 앱 설정 → 내보내기로 받은 백업 파일(.json)을 고르세요. 같은 문장은 건너뛰고, 복습 단계와 들은 횟수는 그대로 옮겨요.</p>
      <label class="btn wood filebtn">백업 파일 고르기<input id="import" type="file" accept="application/json,.json" hidden></label>
    </section>
    <button class="btn wood" data-act="logout">로그아웃</button>
  </main>`;
}

// ───────── 단어 뜻 보기
async function showWord(token: string, sentence: string, card: Card | null, known: Word[]) {
  const t = token.toLowerCase().replace(/[’']s$/, '');
  const hit = known.find((w) => [w.word, w.lemma].some((x) => x.toLowerCase() === t) || w.word.toLowerCase().split(/\s+/).includes(t));
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const show = (w: Word) => {
    sheet.innerHTML = `<div class="panel sheet-in"><b class="sw">${esc(w.word)}</b> <span class="muted">${esc(w.pos)} ${esc(w.ipa)}</span>
      <p class="meaning">${esc(w.meaning_ko)}</p>${w.example_en ? `<p class="muted">예) ${esc(w.example_en)}</p>` : ''}
      <button class="btn wood" data-close>닫기</button></div>`;
  };
  sheet.addEventListener('click', (e) => { if (e.target === sheet || (e.target as HTMLElement).closest('[data-close]')) sheet.remove(); });
  document.body.appendChild(sheet);
  if (hit) return show(hit);
  sheet.innerHTML = `<div class="panel sheet-in"><b>${esc(token)}</b><p class="muted">뜻 찾는 중…</p></div>`;
  try {
    const w = await api.word(token, sentence);
    show(w);
    if (card) {
      const updated = await api.addWords(card.id, [w]);
      cards = cards.map((c) => (c.id === updated.id ? updated : c));
      review.queue = review.queue.map((c) => (c.id === updated.id ? updated : c));
    } else if (create.result) create.result.words.push(w);
  } catch (e) {
    sheet.innerHTML = `<div class="panel sheet-in"><b>${esc(token)}</b><p>${esc(errMsg(e))}</p><button class="btn wood" data-close>닫기</button></div>`;
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
    if (!(e instanceof ApiError && e.status === 401)) { app.innerHTML = `<p class="center">${esc(errMsg(e))}<br><button class="btn gold" onclick="location.reload()">다시 시도</button></p>`; return; }
    screen = 'login';
  }
  render();
}

function go(s: Screen) {
  stopAudio();
  if (create.recording) { cancelRecording(); create.recording = false; }
  if (s === 'review' && screen !== 'review') { review.queue = dueCards(); review.i = 0; review.revealed = false; review.done = 0; review.heard = 0; review.combo = 0; review.xp = 0; review.hint = false; }
  if (speakSt.recording) cancelRecording();
  speakSt.key = ''; speakSt.recording = false; speakSt.result = null;
  screen = s;
  render();
  window.scrollTo(0, 0);
  if (s === 'settings') refreshPush().then(render);
}

async function generate() {
  const ko = (document.getElementById('ko') as HTMLTextAreaElement).value.trim();
  if (!ko) return toast('한국어 문장을 입력해 주세요');
  create.ko = ko;
  const r = await run('주문을 만드는 중… (5~15초)', () => api.express(ko));
  if (!r) return;
  create.result = r; create.heard = 0; create.saved = null;
  render();
  prefetchVoice(r.en);
}

async function createPlay(times: number) {
  const r = create.result!;
  if (create.playing) { stopAudio(); create.playing = false; render(); return; }
  create.playing = true; render();
  try {
    const before = create.heard;
    const heard = await playTimes(r.en, times, (n) => { create.heard = before + n; updateCount(create.heard, repeat); });
    if (create.saved && heard) {
      const updated = await api.listen(create.saved.id, heard);
      cards = cards.map((c) => (c.id === updated.id ? updated : c));
    }
    // 반복 듣기를 끝까지 들으면 경험치
    if (times > 1 && heard >= times) { gain(XP.loop, (d) => { d.loops++; }); toast(`끝까지 들었어요! +${XP.loop} XP`); }
  } catch (e) { toast(errMsg(e)); }
  create.playing = false; render();
}

function updateCount(n: number, of: number) {
  const b = document.querySelector('.count b');
  if (b) b.textContent = String(n);
  const bar = document.querySelector('.meter i') as HTMLElement | null;
  if (bar) bar.style.width = `${Math.min(100, (n / of) * 100)}%`;
}

async function save() {
  const r = create.result!;
  const card = await run('도감에 저장하는 중…', () => api.createCard({ ko: create.ko, en: r.en, alts: r.alts, note: r.note_ko, words: r.words, listens: create.heard }));
  if (!card) return;
  cards.push(card);
  create.saved = card;
  gain(XP.create, (d) => { d.created++; }, (t) => { t.created++; });
  render();
}

async function reveal() {
  review.revealed = true;
  review.heard = 0;
  render();
  reviewPlay();
}

async function reviewPlay(times = REVIEW_AUTO) {
  const c = review.queue[review.i];
  if (review.playing) { stopAudio(); review.playing = false; render(); return; }
  review.target = times;
  review.playing = true; render();
  try {
    const before = review.heard;
    await playTimes(c.en, times, (n) => { review.heard = before + n; updateCount(review.heard, times); });
  } catch (e) { toast(errMsg(e)); }
  review.playing = false; render();
}

async function grade(g: Grade) {
  const c = review.queue[review.i];
  stopAudio(); review.playing = false;
  const r = await run('저장하는 중…', async () => (await api.review(c.id, g, review.heard)).card);
  if (!r) return;
  cards = cards.map((x) => (x.id === r.id ? r : x));
  review.combo = g === 'good' ? review.combo + 1 : 0;
  let xp = (g === 'good' ? XP.good : g === 'hard' ? XP.hard : XP.again) + (g === 'good' ? Math.min(Math.max(0, review.combo - 1) * XP.comboBonus, 10) : 0);
  if (review.hint) xp = Math.ceil(xp / 2);
  floatXP(g === 'again' ? `💨 +${xp} XP` : `${g === 'good' ? '💥' : '⚔️'} +${xp} XP`);
  review.xp += xp;
  review.done++;
  // 맞히면 몬스터가 쓰러지는 모습을 잠깐 보여 줌
  if (g !== 'again') { review.hit = true; render(); await new Promise((res) => setTimeout(res, 450)); review.hit = false; }
  review.i++; review.revealed = false; review.heard = 0; review.hint = false;
  speakSt.key = ''; speakSt.result = null;
  const finished = review.i >= review.queue.length && dueCards().length === 0;
  gain(xp, (d) => { d.reviewed++; if (finished) d.allDone = true; }, (t) => { t.reviewed++; });
  render();
  window.scrollTo(0, 0);
  const next = review.queue[review.i];
  if (next) prefetchVoice(next.en);
}

/** 🎙️ 말하기: 누르면 녹음 시작, 다시 누르면 채점 */
async function toggleSpeak(key: string) {
  const [kind, id] = key.split(':');
  const card = kind === 'c' ? create.saved : cards.find((x) => x.id === id) ?? review.queue[review.i];
  const target = card?.en ?? '';
  if (!target) return;
  if (!(speakSt.recording && speakSt.key === key)) {
    if (speakSt.recording) cancelRecording();
    stopAudio();
    try {
      await startRecording(30_000, () => toggleSpeak(key));
      speakSt.key = key; speakSt.recording = true; speakSt.result = null; render();
    } catch (e) { toast(errMsg(e)); }
    return;
  }
  speakSt.recording = false;
  const heard = await run('말한 영어를 듣고 채점하는 중…', () => stopAndTranscribe('en'));
  if (heard === undefined) { render(); return; }
  const res = compare(target, heard);
  speakSt.result = res;
  // 보상: 80점 이상, 같은 주문은 하루 한 번
  const rk = `${kstDay()}:${card!.id}`;
  if (res.score >= 80 && !speakRewarded.has(rk)) {
    speakRewarded.add(rk);
    const bonus = XP.speak + (res.score >= 95 ? XP.perfect : 0);
    floatXP(`🎙️ +${bonus} XP`);
    gain(bonus, (d) => { d.spoken = (d.spoken ?? 0) + 1; }, (t) => { t.spoken++; if (res.score >= 95) t.perfect++; });
  }
  // 모험 중이면 말한 뒤 정답을 공개하고, 점수에 맞는 채점 버튼을 추천
  if (kind === 'r' && !review.revealed) { review.revealed = true; review.heard = 0; render(); reviewPlay(); return; }
  render();
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
    const r = await run(`주문 ${data.cards.length}개 가져오는 중…`, () => api.importBackup(data.cards, data.stats ?? {}));
    if (r) { await loadAll(); toast(`${r.imported}개 가져왔어요${r.skipped ? ` (이미 있는 ${r.skipped}개는 건너뜀)` : ''}`); render(); }
  } catch (err) { toast(err instanceof SyntaxError ? '파일을 읽지 못했어요 (.json 백업 파일인지 확인해 주세요)' : errMsg(err)); }
  t.value = '';
});

app.addEventListener('input', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'ko') create.ko = (t as HTMLTextAreaElement).value;
});

app.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement).closest('button, .w, [data-quest], [data-act]') as HTMLElement | null;
  if (!el) return;
  const d = el.dataset;
  if (d.go) return go(d.go as Screen);
  if (d.rate) { setRate(Number(d.rate)); render(); return; }
  if (d.claim) return claimQuest(d.claim);
  if (d.quest) return goQuest(d.quest);
  if (d.speak) return toggleSpeak(d.speak);
  if (d.tier !== undefined) { tierFilter = d.tier; return render(); }
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
    case 'c-play': return createPlay(repeat);
    case 'c-play1': return createPlay(1);
    case 'r-play': return reviewPlay();
    case 'r-play-full': return reviewPlay(repeat);
    case 'alt-pick': {
      const r = create.result!;
      const i = Number(d.i);
      const picked = r.alts[i];
      r.alts[i] = r.en;
      r.en = picked;
      create.heard = 0;
      stopAudio(); create.playing = false;
      prefetchVoice(picked);
      return render();
    }
    case 'alt-play': {
      const a = create.result?.alts[Number(d.i)];
      if (a) playTimes(a, 1).catch((err) => toast(errMsg(err)));
      return;
    }
    case 'set-repeat': {
      repeat = Number(d.n) || 20;
      try { localStorage.setItem('study.repeat', String(repeat)); } catch { /* 무시 */ }
      return render();
    }
    case 'c-new': create.ko = ''; create.result = null; create.saved = null; create.heard = 0; return render();
    case 'save': return save();
    case 'reveal': return reveal();
    case 'hint': review.hint = true; return render();
    case 'cta': return dueCards().length ? go('review') : go('create');
    case 'dex-all': tierFilter = ''; return go('list');
    case 'dex-master': tierFilter = 'master'; return go('list');
    case 'dex-tier': tierFilter = d.t ?? ''; return go('list');
    case 'd-loop': {
      const c = cards.find((x) => x.id === detailId);
      if (!c) return;
      el.textContent = '재생 중… (다시 누르면 멈춤)';
      el.dataset.act = 'd-stop';
      const heard = await playTimes(c.en, repeat).catch((err) => { toast(errMsg(err)); return 0; });
      if (heard) {
        const updated = await api.listen(c.id, heard).catch(() => null);
        if (updated) cards = cards.map((x) => (x.id === updated.id ? updated : x));
        if (heard >= repeat) { gain(XP.loop, (dd) => { dd.loops++; }); floatXP(`🔁 +${XP.loop} XP`); }
      }
      return render();
    }
    case 'd-stop': stopAudio(); return;
    case 'd-play': {
      const c = cards.find((x) => x.id === detailId);
      if (c) playTimes(c.en, 1).catch((err) => toast(errMsg(err)));
      return;
    }
    case 'delete': {
      if (!confirm('이 주문을 도감에서 지울까요?')) return;
      const ok = await run('지우는 중…', () => api.deleteCard(detailId));
      if (ok) { cards = cards.filter((c) => c.id !== detailId); go('list'); }
      return;
    }
    case 'push-on': {
      const ok = await run('알림을 켜는 중…', enablePush);
      if (ok) toast('알림을 켰어요. 저녁 9시에 몬스터가 나타나 있으면 알려 드려요');
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
    const r = await run(screen === 'setup' ? '모험을 준비하는 중…' : '입장하는 중…', () => (screen === 'setup' ? api.setup(name, password) : api.login(name, password)));
    if (!r) return;
    setToken(r.token); me = r.user;
    await run('불러오는 중…', loadAll);
    go('home');
  }
  if (f.id === 'add-user') {
    const r = await run('계정 만드는 중…', () => api.addUser(name, password));
    if (r) { toast(`${r.user.name} 계정을 만들었어요. 이름과 비밀번호를 전달해 주세요`); f.reset(); }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && me && (screen === 'home' || screen === 'list')) loadAll().then(render).catch(() => {});
});

if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => {});

preloadArt();
start();
