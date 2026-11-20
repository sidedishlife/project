import './style.css';
import type { Card, Word } from './types';
import { generateExpression, lookupWord, friendlyError, type Expression } from './api';
import { inArtifact, sampleCap, downloadsCap, remoteWrite, remoteLoadAll } from './platform';
import { schedule, isDue, newCardSchedule, formatDue, STAGE_LABELS, MASTERED_STAGE, type Grade } from './srs';
import { speak, stopSpeaking, listenKorean, stopListening, sttSupported, ttsSupported } from './speech';
import {
  loadCards, saveCards, loadStats, saveStats, loadSettings, saveSettings, touchStreak, exportBackup, importBackup,
} from './store';

// ───────────────────────── 상태 ─────────────────────────
type View = 'home' | 'create' | 'review' | 'list' | 'settings' | 'detail';
type Mode = 'recall' | 'scramble' | 'listen';

let cards = loadCards();
let stats = loadStats();
let settings = loadSettings();
let hasClaude = false; // claude.ai 안: 내 Claude 계정으로 호출(API 키 불필요)
sampleCap.then((s) => { hasClaude = !!s; render(); });
const aiReady = () => hasClaude || !!settings.apiKey;

const ui = {
  view: 'home' as View,
  detailId: '',
  draftKo: '',
  draft: null as Expression | null,
  busy: false,
  error: '',
  listening: false,
  search: '',
  confirmDelete: '',
};

interface Session {
  queue: string[];
  requeued: Set<string>;
  idx: number;
  mode: Mode;
  revealed: boolean;
  combo: number;
  xp: number;
  done: number;
  correct: number;
  // scramble
  tokens: string[];
  picked: number[];
  // listen
  options: { ko: string; ok: boolean }[];
  answered: number | null;
  feedback: '' | 'ok' | 'ng';
}
let session: Session | null = null;

// 연속 재생(최대 20회) 제어
let loopToken = 0;
let looping = false;

const app = document.getElementById('app')!;

// ───────────────────────── 유틸 ─────────────────────────
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9'-]/g, '').replace(/^'+|'+$/g, '');
const shuffle = <T,>(a: T[]): T[] => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
const level = (xp: number) => Math.floor(Math.sqrt(xp / 50)) + 1;
const levelBase = (lv: number) => (lv - 1) ** 2 * 50;
const getCard = (id: string) => cards.find((c) => c.id === id);
const updateCard = (c: Card) => {
  cards = cards.map((x) => (x.id === c.id ? c : x));
  saveCards(cards);
  remoteWrite(c.id, c as unknown as Record<string, unknown>);
};
const putStats = () => {
  saveStats(stats);
  remoteWrite('_stats', stats as unknown as Record<string, unknown>);
};
const dueCards = () => cards.filter((c) => isDue(c)).sort((a, b) => a.due - b.due);
const addXp = (n: number) => {
  stats = touchStreak({ ...stats, xp: stats.xp + n });
  putStats();
};

function toast(msg: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function go(view: View, extra: Partial<typeof ui> = {}) {
  stopLoop();
  Object.assign(ui, { view, error: '' }, extra);
  render();
  window.scrollTo(0, 0);
}

// ───────────────────────── 공통 조각 ─────────────────────────
function sentenceHTML(text: string, cardId = '') {
  return text
    .split(/(\s+)/)
    .map((t) => (/^\s+$/.test(t) || !norm(t) ? esc(t) : `<button class="tok" data-action="word" data-word="${esc(norm(t))}" data-card="${cardId}">${esc(t)}</button>`))
    .join('');
}

function playerHTML(card: Card) {
  const target = settings.listenTarget;
  const n = Math.min(card.listens, target);
  const pct = Math.round((n / target) * 100);
  return `
  <div class="player">
    <div class="ring" style="--p:${pct}">
      <button class="play" data-action="play" data-id="${card.id}" aria-label="한 번 듣기">▶</button>
    </div>
    <div class="player-info">
      <div class="count"><b id="listen-count">${card.listens}</b> / ${target}회 들음</div>
      <div class="row">
        <button class="btn sm ${looping ? 'danger' : 'primary'}" data-action="loop" data-id="${card.id}">
          ${looping ? '■ 정지' : `🔁 ${Math.max(target - card.listens, 0) || target}회 연속 재생`}
        </button>
        <button class="btn sm ghost" data-action="slow" data-id="${card.id}">🐢 천천히</button>
      </div>
    </div>
  </div>`;
}

function wordChipsHTML(card: Card) {
  if (!card.words.length) return '';
  return `<div class="chips">${card.words
    .map((w) => `<button class="chip" data-action="word" data-word="${esc(norm(w.word))}" data-card="${card.id}"><b>${esc(w.word)}</b> ${esc(w.meaning_ko)}</button>`)
    .join('')}</div>`;
}

function stageBadge(c: Card) {
  return `<span class="badge s${c.stage}">${STAGE_LABELS[c.stage]}</span>`;
}

// ───────────────────────── 화면 ─────────────────────────
function homeView() {
  const due = dueCards().length;
  const lv = level(stats.xp);
  const into = stats.xp - levelBase(lv);
  const need = levelBase(lv + 1) - levelBase(lv);
  const counts = STAGE_LABELS.map((_, i) => cards.filter((c) => c.stage === i).length);
  const max = Math.max(1, ...counts);
  const next = cards.filter((c) => !isDue(c)).sort((a, b) => a.due - b.due)[0];
  return `
  <header class="hero">
    <div class="hero-top">
      <div><div class="muted">Lv.${lv}</div><div class="xpbar"><i style="width:${(into / need) * 100}%"></i></div><div class="muted small">${into} / ${need} XP</div></div>
      <div class="streak">🔥 <b>${stats.streak}</b><span>일 연속</span></div>
    </div>
    <div class="due-box">
      <div class="due-num">${due}</div>
      <div>${due ? '개의 표현이 잊혀지기 직전이에요' : next ? `다음 복습: ${formatDue(next)}` : '첫 표현을 만들어 보세요'}</div>
      ${due ? `<button class="btn primary big" data-action="start-review">⚔️ 복습 시작</button>` : `<button class="btn primary big" data-action="nav" data-view="create">✍️ 새 표현 만들기</button>`}
    </div>
  </header>
  <section class="card">
    <h3>기억 단계 <span class="muted small">총 ${cards.length}개 · 마스터 ${counts[MASTERED_STAGE]}개</span></h3>
    <div class="stages">${counts
      .map((n, i) => `<div class="stage"><div class="bar"><i class="s${i}" style="height:${(n / max) * 100}%"></i></div><b>${n}</b><span>${STAGE_LABELS[i]}</span></div>`)
      .join('')}</div>
  </section>
  ${cards.length ? `<section class="card"><h3>최근 표현</h3>${cards.slice(-3).reverse().map(listItem).join('')}</section>` : ''}
  `;
}

function createView() {
  const d = ui.draft;
  return `
  <section class="card">
    <h2>영어로 뭐라고 하지?</h2>
    <p class="muted">하고 싶은 말을 한국어로 쓰거나 말해 보세요.</p>
    <textarea id="ko" rows="3" placeholder="예) 이 도면 검토는 금요일까지 끝낼 수 있을 것 같아요">${esc(ui.draftKo)}</textarea>
    <div class="row">
      ${sttSupported() ? `<button class="btn ${ui.listening ? 'danger' : 'ghost'}" data-action="mic">${ui.listening ? '■ 그만 듣기' : '🎙️ 말하기'}</button>` : ''}
      <button class="btn primary grow" data-action="generate" ${ui.busy ? 'disabled' : ''}>${ui.busy ? '<span class="spin"></span> 만드는 중…' : '✨ 영어 표현 만들기'}</button>
    </div>
    ${!aiReady() ? `<p class="warn">먼저 <a href="#" data-action="nav" data-view="settings">설정</a>에서 API 키를 입력해 주세요.</p>` : ''}
    ${ui.error ? `<p class="warn">${esc(ui.error)}</p>` : ''}
  </section>
  ${d ? draftHTML(d) : ''}`;
}

function draftHTML(d: Expression) {
  const temp: Card = { id: 'draft', ko: ui.draftKo, en: d.en, alts: d.alts, note: d.note_ko, words: d.words, createdAt: 0, ...newCardSchedule(), listens: draftListens };
  return `
  <section class="card result">
    <div class="en">${sentenceHTML(d.en, 'draft')}</div>
    <p class="muted small">👆 모르는 단어를 누르면 뜻을 볼 수 있어요</p>
    ${playerHTML(temp)}
    ${d.note_ko ? `<p class="note">💡 ${esc(d.note_ko)}</p>` : ''}
    ${d.alts.length ? `<div class="alts"><div class="muted small">다른 표현</div>${d.alts.map((a) => `<div class="alt"><span>${esc(a)}</span><button class="icon" data-action="say" data-text="${esc(a)}">🔊</button></div>`).join('')}</div>` : ''}
    ${wordChipsHTML(temp)}
    <div class="row">
      <button class="btn ghost" data-action="discard">다시 만들기</button>
      <button class="btn primary grow" data-action="save">📌 복습 덱에 저장</button>
    </div>
  </section>`;
}
let draftListens = 0;

function listItem(c: Card) {
  return `<button class="item" data-action="detail" data-id="${c.id}">
    <div class="item-main"><div class="item-en">${esc(c.en)}</div><div class="muted small">${esc(c.ko)}</div></div>
    <div class="item-side">${stageBadge(c)}<div class="muted small">${formatDue(c)}</div></div>
  </button>`;
}

function listView() {
  const q = ui.search.trim().toLowerCase();
  const list = cards.filter((c) => !q || c.en.toLowerCase().includes(q) || c.ko.includes(q)).slice().reverse();
  return `
  <section class="card">
    <h2>내 표현 <span class="muted small">${cards.length}개</span></h2>
    <input id="search" type="search" placeholder="검색 (영어/한국어)" value="${esc(ui.search)}">
  </section>
  <section class="card list">${list.length ? list.map(listItem).join('') : '<p class="muted">아직 저장한 표현이 없어요.</p>'}</section>`;
}

function detailView() {
  const c = getCard(ui.detailId);
  if (!c) return '<p>삭제된 표현입니다.</p>';
  return `
  <section class="card result">
    <div class="muted">${esc(c.ko)}</div>
    <div class="en">${sentenceHTML(c.en, c.id)}</div>
    ${playerHTML(c)}
    ${c.note ? `<p class="note">💡 ${esc(c.note)}</p>` : ''}
    ${c.alts.length ? `<div class="alts"><div class="muted small">다른 표현</div>${c.alts.map((a) => `<div class="alt"><span>${esc(a)}</span><button class="icon" data-action="say" data-text="${esc(a)}">🔊</button></div>`).join('')}</div>` : ''}
    ${wordChipsHTML(c)}
    <div class="meta muted small">${stageBadge(c)} 다음 복습 ${formatDue(c)} · 복습 ${c.reviews}회 · 잊음 ${c.lapses}회</div>
    <div class="row"><button class="btn ghost" data-action="nav" data-view="list">← 목록</button><button class="btn danger" data-action="delete" data-id="${c.id}">${ui.confirmDelete === c.id ? '정말 삭제할까요? 한 번 더 누르기' : '삭제'}</button></div>
  </section>`;
}

function settingsView() {
  return `
  <section class="card">
    <h2>설정</h2>
    ${hasClaude ? `<p class="ok-note">✅ claude.ai 계정으로 연결돼 있어 API 키 없이 쓸 수 있어요. 표현은 내 계정에 저장돼요.</p><input id="apikey" type="hidden" value="${esc(settings.apiKey)}">` : `
    <label>Anthropic API 키<input id="apikey" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(settings.apiKey)}"></label>
    <p class="muted small">키는 이 휴대폰 안에만 저장되고 Anthropic 서버로만 전송돼요. 키 발급: console.anthropic.com</p>`}
    <label>읽기 속도 <b id="rate-v">${settings.rate.toFixed(2)}x</b><input id="rate" type="range" min="0.5" max="1.2" step="0.05" value="${settings.rate}"></label>
    <label>표현당 목표 듣기 횟수<input id="target" type="number" min="1" max="100" value="${settings.listenTarget}"></label>
    <button class="btn primary" data-action="save-settings">저장</button>
    ${!ttsSupported() ? '<p class="warn">이 브라우저는 음성 읽기를 지원하지 않아요.</p>' : ''}
  </section>
  <section class="card">
    <h3>백업</h3>
    <p class="muted small">데이터는 이 기기 브라우저에 저장돼요. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 백업하세요.</p>
    <div class="row"><button class="btn ghost" data-action="export">⬇️ 내보내기</button><label class="btn ghost">⬆️ 가져오기<input id="import" type="file" accept="application/json" hidden></label></div>
  </section>
  <section class="card">
    <h3>망각곡선 복습 원리</h3>
    <p class="muted small">사람은 배운 지 하루만 지나도 절반 이상을 잊어요(에빙하우스). 잊기 직전에 다시 떠올리면 기억이 더 오래 갑니다.
    그래서 맞히면 간격이 <b>10분 → 1일 → 3일 → 1주 → 2주 → 1달 → 2달 → 마스터</b>로 늘어나고, 틀리면 처음부터 다시 시작해요.</p>
  </section>`;
}

// ───────────────────────── 복습 게임 ─────────────────────────
function startReview() {
  const due = dueCards().slice(0, 20);
  if (!due.length) return toast('지금 복습할 표현이 없어요');
  session = {
    queue: due.map((c) => c.id), requeued: new Set(), idx: 0, mode: 'recall', revealed: false,
    combo: 0, xp: 0, done: 0, correct: 0, tokens: [], picked: [], options: [], answered: null, feedback: '',
  };
  setupRound();
  go('review');
}

function setupRound() {
  if (!session) return;
  const c = getCard(session.queue[session.idx]);
  if (!c) return;
  const words = c.en.split(/\s+/).filter(Boolean);
  const modes: Mode[] = ['recall'];
  if (words.length >= 3 && words.length <= 14) modes.push('scramble');
  if (cards.length >= 4 && ttsSupported()) modes.push('listen');
  // 처음 단계일수록 쉬운 듣기/배열, 높은 단계일수록 직접 떠올리기(회상)가 기억에 더 효과적
  const pool = c.stage >= 3 ? [...modes, 'recall', 'recall'] : modes;
  session.mode = pool[Math.floor(Math.random() * pool.length)] as Mode;
  session.revealed = false;
  session.feedback = '';
  session.answered = null;
  session.picked = [];
  session.tokens = shuffle(words);
  if (session.mode === 'listen') {
    const others = shuffle(cards.filter((x) => x.id !== c.id && x.ko !== c.ko)).slice(0, 3);
    session.options = shuffle([{ ko: c.ko, ok: true }, ...others.map((o) => ({ ko: o.ko, ok: false }))]);
    setTimeout(() => speak(c.en, settings.rate), 300);
  }
}

function reviewView() {
  if (!session) return '';
  if (session.idx >= session.queue.length) return summaryView();
  const c = getCard(session.queue[session.idx])!;
  const total = session.queue.length;
  const head = `
  <div class="game-head">
    <button class="icon" data-action="quit">✕</button>
    <div class="progress"><i style="width:${(session.idx / total) * 100}%"></i></div>
    <div class="combo ${session.combo >= 3 ? 'hot' : ''}">${session.combo ? `x${session.combo}` : ''}</div>
  </div>`;
  let body = '';
  if (session.mode === 'recall') {
    body = `
    <div class="q-label">이 말을 영어로 소리 내어 말해 보세요</div>
    <div class="q-ko">${esc(c.ko)}</div>
    ${session.revealed ? `
      <div class="answer"><div class="en">${sentenceHTML(c.en, c.id)}</div>${wordChipsHTML(c)}</div>
      <div class="grades">
        <button class="btn g-again" data-action="grade" data-g="again">몰랐음<small>10분 후</small></button>
        <button class="btn g-hard" data-action="grade" data-g="hard">헷갈림<small>다시 한번</small></button>
        <button class="btn g-good" data-action="grade" data-g="good">알았음<small>간격 ↑</small></button>
      </div>` : `<button class="btn primary big" data-action="reveal">정답 보기</button>`}`;
  } else if (session.mode === 'scramble') {
    const built = session.picked.map((i) => session!.tokens[i]).join(' ');
    body = `
    <div class="q-label">단어를 순서대로 눌러 문장을 완성하세요</div>
    <div class="q-ko">${esc(c.ko)}</div>
    <div class="built ${session.feedback}">${esc(built) || '<span class="muted">여기에 문장이 만들어져요</span>'}</div>
    ${session.feedback === 'ng' ? `<div class="answer"><div class="muted small">정답</div><div class="en">${sentenceHTML(c.en, c.id)}</div></div>` : ''}
    ${session.feedback ? `<button class="btn primary big" data-action="next">다음 ▶</button>` : `
    <div class="pool">${session.tokens.map((t, i) => `<button class="tile" data-action="pick" data-i="${i}" ${session!.picked.includes(i) ? 'disabled' : ''}>${esc(t)}</button>`).join('')}</div>
    <div class="row"><button class="btn ghost" data-action="undo">↶ 되돌리기</button><button class="btn primary grow" data-action="check" ${session.picked.length !== session.tokens.length ? 'disabled' : ''}>확인</button></div>`}`;
  } else {
    body = `
    <div class="q-label">듣고 알맞은 뜻을 고르세요</div>
    <button class="play big-play" data-action="say" data-text="${esc(c.en)}">🔊</button>
    <div class="opts">${session.options
      .map((o, i) => {
        const cls = session!.answered === null ? '' : o.ok ? 'ok' : session!.answered === i ? 'ng' : 'dim';
        return `<button class="opt ${cls}" data-action="choose" data-i="${i}" ${session!.answered !== null ? 'disabled' : ''}>${esc(o.ko)}</button>`;
      })
      .join('')}</div>
    ${session.answered !== null ? `<div class="answer"><div class="en">${sentenceHTML(c.en, c.id)}</div></div><button class="btn primary big" data-action="next">다음 ▶</button>` : ''}`;
  }
  return `<section class="game">${head}<div class="game-body">${body}</div></section>`;
}

function summaryView() {
  const s = session!;
  const acc = s.done ? Math.round((s.correct / s.done) * 100) : 0;
  return `
  <section class="card summary">
    <div class="trophy">🏆</div>
    <h2>복습 완료!</h2>
    <div class="sum-grid"><div><b>+${s.xp}</b><span>XP</span></div><div><b>${acc}%</b><span>정확도</span></div><div><b>🔥${stats.streak}</b><span>연속</span></div></div>
    <p class="muted">맞힌 표현은 더 긴 간격 뒤에 다시 나와요. 틀린 표현은 10분 뒤에 다시 만나요.</p>
    <button class="btn primary big" data-action="nav" data-view="home">홈으로</button>
  </section>`;
}

function grade(g: Grade) {
  if (!session) return;
  const id = session.queue[session.idx];
  const c = getCard(id);
  if (!c) return;
  updateCard(schedule(c, g));
  session.done++;
  if (g === 'good') {
    session.correct++;
    session.combo++;
    const gain = 10 + Math.min(session.combo, 10) * 2;
    session.xp += gain;
    addXp(gain);
    if (session.combo > stats.bestCombo) { stats.bestCombo = session.combo; putStats(); }
  } else {
    session.combo = 0;
    const gain = g === 'hard' ? 5 : 2;
    session.xp += gain;
    addXp(gain);
    // 틀린 표현은 이번 판 끝에서 한 번 더 (같은 세션 내 재노출)
    if (g === 'again' && !session.requeued.has(id)) {
      session.requeued.add(id);
      session.queue.push(id);
    }
  }
  session.idx++;
  if (session.idx < session.queue.length) setupRound();
  render();
}

// ───────────────────────── 듣기 ─────────────────────────
function cardForPlayer(id: string): Card | null {
  if (id === 'draft' && ui.draft) {
    return { id: 'draft', ko: ui.draftKo, en: ui.draft.en, alts: [], note: '', words: ui.draft.words, createdAt: 0, ...newCardSchedule(), listens: draftListens };
  }
  return getCard(id) ?? null;
}

function countListen(id: string) {
  if (id === 'draft') draftListens++;
  else {
    const c = getCard(id);
    if (c) updateCard({ ...c, listens: c.listens + 1 });
  }
  const c = cardForPlayer(id);
  const el = document.getElementById('listen-count');
  if (el && c) el.textContent = String(c.listens);
  const ring = document.querySelector<HTMLElement>('.ring');
  if (ring && c) ring.style.setProperty('--p', String(Math.round((Math.min(c.listens, settings.listenTarget) / settings.listenTarget) * 100)));
}

async function playOnce(id: string, rate = settings.rate) {
  const c = cardForPlayer(id);
  if (!c) return;
  document.querySelector('.play')?.classList.add('on');
  await speak(c.en, rate);
  document.querySelector('.play')?.classList.remove('on');
  countListen(id);
}

async function startLoop(id: string) {
  const c = cardForPlayer(id);
  if (!c) return;
  const times = Math.max(settings.listenTarget - c.listens, 0) || settings.listenTarget;
  const token = ++loopToken;
  looping = true;
  render();
  for (let i = 0; i < times && token === loopToken; i++) {
    await playOnce(id);
    if (token !== loopToken) break;
    await new Promise((r) => setTimeout(r, 1200)); // 따라 말할 틈
  }
  if (token === loopToken) {
    looping = false;
    addXp(5);
    toast(`🎧 ${times}회 듣기 완료! +5XP`);
    render();
  }
}

function stopLoop() {
  loopToken++;
  looping = false;
  stopSpeaking();
}

// ───────────────────────── 단어 사전 시트 ─────────────────────────
async function showWord(wordKey: string, cardId: string) {
  const sentence = cardId === 'draft' ? ui.draft?.en ?? '' : getCard(cardId)?.en ?? '';
  const words = cardId === 'draft' ? ui.draft?.words ?? [] : getCard(cardId)?.words ?? [];
  let w = words.find((x) => norm(x.word) === wordKey || norm(x.lemma) === wordKey);
  openSheet(w ? wordHTML(w) : `<div class="sheet-word">${esc(wordKey)}</div><p class="muted"><span class="spin"></span> 사전 찾는 중…</p>`);
  if (w) return;
  if (!aiReady()) return openSheet(`<div class="sheet-word">${esc(wordKey)}</div><p class="warn">API 키가 필요해요.</p>`);
  try {
    w = await lookupWord(settings.apiKey, wordKey, sentence);
    // 한 번 찾은 단어는 카드에 저장 → 다음엔 즉시, 오프라인에서도 표시
    if (cardId === 'draft' && ui.draft) ui.draft.words.push(w);
    else {
      const c = getCard(cardId);
      if (c) updateCard({ ...c, words: [...c.words, w] });
    }
    openSheet(wordHTML(w));
  } catch (e) {
    openSheet(`<div class="sheet-word">${esc(wordKey)}</div><p class="warn">${esc(friendlyError(e))}</p>`);
  }
}

function wordHTML(w: Word) {
  return `
  <div class="sheet-word">${esc(w.word)} <button class="icon" data-action="say" data-text="${esc(w.lemma || w.word)}">🔊</button></div>
  <div class="muted">${esc(w.ipa)} · ${esc(w.pos)}${w.lemma && norm(w.lemma) !== norm(w.word) ? ` · 기본형 <b>${esc(w.lemma)}</b>` : ''}</div>
  <div class="sheet-mean">${esc(w.meaning_ko)}</div>
  ${w.example_en ? `<div class="sheet-ex"><span>${esc(w.example_en)}</span><button class="icon" data-action="say" data-text="${esc(w.example_en)}">🔊</button></div>` : ''}`;
}

function openSheet(html: string) {
  let s = document.getElementById('sheet');
  if (!s) {
    s = document.createElement('div');
    s.id = 'sheet';
    s.innerHTML = `<div class="backdrop" data-action="close-sheet"></div><div class="sheet"><div class="grip"></div><div class="sheet-body"></div></div>`;
    document.body.appendChild(s);
  }
  s.querySelector('.sheet-body')!.innerHTML = html;
}
const closeSheet = () => document.getElementById('sheet')?.remove();

// ───────────────────────── 렌더 ─────────────────────────
function render() {
  const views: Record<View, () => string> = {
    home: homeView, create: createView, review: reviewView, list: listView, settings: settingsView, detail: detailView,
  };
  const due = dueCards().length;
  const tab = (v: View, icon: string, label: string) =>
    `<button class="tab ${ui.view === v || (v === 'list' && ui.view === 'detail') ? 'on' : ''}" data-action="${v === 'review' ? 'start-review' : 'nav'}" data-view="${v}">${icon}<span>${label}</span>${v === 'review' && due ? `<em>${due}</em>` : ''}</button>`;
  app.innerHTML = `
    <main class="${ui.view}">${views[ui.view]()}</main>
    ${ui.view === 'review' ? '' : `<nav class="tabs">${tab('home', '🏠', '홈')}${tab('create', '✍️', '만들기')}${tab('review', '⚔️', '복습')}${tab('list', '📚', '내 표현')}${tab('settings', '⚙️', '설정')}</nav>`}`;
}

// ───────────────────────── 이벤트 ─────────────────────────
app.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'ko') ui.draftKo = t.value;
  if (t.id === 'search') {
    ui.search = t.value;
    const pos = t.selectionStart;
    render();
    const s = document.getElementById('search') as HTMLInputElement;
    s.focus();
    s.setSelectionRange(pos, pos);
  }
  if (t.id === 'rate') document.getElementById('rate-v')!.textContent = `${Number(t.value).toFixed(2)}x`;
});

app.addEventListener('change', async (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'import' && t.files?.[0]) {
    try {
      importBackup(await t.files[0].text());
      cards = loadCards();
      stats = loadStats();
      toast(`${cards.length}개 표현을 가져왔어요`);
      render();
    } catch (err) {
      toast(friendlyError(err));
    }
  }
});

document.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el) return;
  const a = el.dataset.action!;
  if (el.tagName === 'A') e.preventDefault();

  switch (a) {
    case 'nav': {
      closeSheet();
      return go(el.dataset.view as View);
    }
    case 'start-review':
      return startReview();
    case 'detail':
      return go('detail', { detailId: el.dataset.id! });
    case 'mic': {
      if (ui.listening) { stopListening(); return; }
      ui.listening = true;
      const pending = listenKorean((t) => {
          const ta = document.getElementById('ko') as HTMLTextAreaElement | null;
          if (ta) ta.value = t;
        });
      render();
      try {
        const text = await pending;
        if (text) ui.draftKo = text;
      } catch (err) {
        ui.error = friendlyError(err);
      }
      ui.listening = false;
      return render();
    }
    case 'generate': {
      const ko = ui.draftKo.trim();
      if (!ko) return toast('한국어 문장을 입력해 주세요');
      if (!aiReady()) return go('settings');
      ui.busy = true;
      ui.error = '';
      render();
      try {
        ui.draft = await generateExpression(settings.apiKey, ko);
        draftListens = 0;
        ui.busy = false;
        render();
        playOnce('draft');
      } catch (err) {
        ui.busy = false;
        ui.error = friendlyError(err);
        render();
      }
      return;
    }
    case 'discard':
      stopLoop();
      ui.draft = null;
      return render();
    case 'save': {
      if (!ui.draft) return;
      stopLoop();
      const card: Card = {
        id: uid(), ko: ui.draftKo.trim(), en: ui.draft.en, alts: ui.draft.alts, note: ui.draft.note_ko,
        words: ui.draft.words, createdAt: Date.now(), ...newCardSchedule(), listens: draftListens,
      };
      cards = [...cards, card];
      saveCards(cards);
      remoteWrite(card.id, card as unknown as Record<string, unknown>);
      addXp(10);
      ui.draft = null;
      ui.draftKo = '';
      toast('📌 저장! 10분 뒤 첫 복습이 열려요 (+10XP)');
      return go('detail', { detailId: card.id });
    }
    case 'play':
      if (looping) stopLoop();
      return playOnce(el.dataset.id!);
    case 'slow':
      stopLoop();
      return playOnce(el.dataset.id!, Math.max(0.5, settings.rate - 0.25));
    case 'loop':
      if (looping) { stopLoop(); return render(); }
      return startLoop(el.dataset.id!);
    case 'say':
      return speak(el.dataset.text!, settings.rate);
    case 'word':
      return showWord(el.dataset.word!, el.dataset.card!);
    case 'close-sheet':
      return closeSheet();
    case 'delete': {
      const id = el.dataset.id!;
      if (ui.confirmDelete !== id) { ui.confirmDelete = id; return render(); }
      cards = cards.filter((c) => c.id !== id);
      saveCards(cards);
      remoteWrite(id, null);
      return go('list', { confirmDelete: '' });
    }
    case 'save-settings': {
      settings = {
        apiKey: (document.getElementById('apikey') as HTMLInputElement).value.trim(),
        rate: Number((document.getElementById('rate') as HTMLInputElement).value),
        listenTarget: Math.max(1, Math.min(100, Number((document.getElementById('target') as HTMLInputElement).value) || 20)),
      };
      saveSettings(settings);
      return toast('저장했어요');
    }
    case 'export': {
      const dl = await downloadsCap;
      if (dl) {
        try { await dl.save({ filename: `english-backup-${new Date().toISOString().slice(0, 10)}.json`, data: exportBackup() }); } catch { /* 사용자가 취소 */ }
        return;
      }
      const blob = new Blob([exportBackup()], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `english-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      return;
    }
    // 복습 게임
    case 'quit':
      session = null;
      return go('home');
    case 'reveal':
      session!.revealed = true;
      render();
      return speak(getCard(session!.queue[session!.idx])!.en, settings.rate);
    case 'grade':
      return grade(el.dataset.g as Grade);
    case 'pick':
      session!.picked.push(Number(el.dataset.i));
      speak(session!.tokens[Number(el.dataset.i)], settings.rate);
      return render();
    case 'undo':
      session!.picked.pop();
      return render();
    case 'check': {
      const s = session!;
      const c = getCard(s.queue[s.idx])!;
      const built = s.picked.map((i) => s.tokens[i]).join(' ');
      const ok = built.split(/\s+/).map(norm).join(' ') === c.en.split(/\s+/).map(norm).join(' ');
      s.feedback = ok ? 'ok' : 'ng';
      render();
      speak(c.en, settings.rate);
      return;
    }
    case 'choose': {
      const s = session!;
      s.answered = Number(el.dataset.i);
      s.feedback = s.options[s.answered].ok ? 'ok' : 'ng';
      return render();
    }
    case 'next':
      return grade(session!.feedback === 'ok' ? 'good' : 'again');
  }
});

// 복습 시간이 지나면 홈 화면 숫자 갱신
setInterval(() => { if (ui.view === 'home') render(); }, 60_000);

render();

// 계정 저장소에서 불러오기 (claude.ai 안에서만). 처음이면 이 기기 데이터를 올림
remoteLoadAll().then((remote) => {
  if (!remote) return;
  const remoteCards = Object.entries(remote).filter(([k]) => !k.startsWith('_')).map(([, v]) => v as Card);
  if (remoteCards.length || remote._stats) {
    cards = remoteCards.sort((a, b) => a.createdAt - b.createdAt);
    if (remote._stats) stats = { ...stats, ...(remote._stats as typeof stats) };
    saveCards(cards);
    saveStats(stats);
  } else {
    cards.forEach((c) => remoteWrite(c.id, c as unknown as Record<string, unknown>));
    if (stats.xp) putStats();
  }
  render();
});

if ('serviceWorker' in navigator && import.meta.env.PROD && !inArtifact) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
