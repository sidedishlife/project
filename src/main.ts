import './style.css';
import type { Card, Word } from './types';
import { generateExpression, lookupWord, friendlyError, type Expression } from './api';
import { inArtifact, sampleCap, downloadsCap, remoteWrite, remoteLoadAll } from './platform';
import { schedule, isDue, newCardSchedule, formatDue, STAGE_LABELS, type Grade } from './srs';
import { speak, stopSpeaking, listenKorean, stopListening, sttSupported, ttsSupported } from './speech';
import {
  loadCards, saveCards, loadStats, saveStats, loadSettings, saveSettings, touchStreak, exportBackup, importBackup, fixStats,
} from './store';
import {
  levelOf, xpForLevel, FORMS, formIndex, heroSVG, monsterSVG, rarity, QUESTS, BADGES, sfx, setSound, confetti, floatXp,
} from './game';

// ───────────────────────── 상태 ─────────────────────────
type View = 'home' | 'create' | 'review' | 'list' | 'settings' | 'detail';
type Mode = 'recall' | 'scramble' | 'listen';

let cards = loadCards();
let stats = loadStats();
let settings = loadSettings();
setSound(settings.sound);
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
  newCardId: '', // 방금 획득한 카드(등장 연출)
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
  defeated: number;
  startLevel: number;
  startXp: number;
  arena: 'idle' | 'hit' | 'laugh';
  tokens: string[];
  picked: number[];
  options: { ko: string; ok: boolean }[];
  answered: number | null;
  feedback: '' | 'ok' | 'ng';
}
let session: Session | null = null;

// 연속 재생(최대 20회) 제어
let loopToken = 0;
let looping = false;

// 레벨업 연출 대기열 (렌더 후 표시)
let pendingLevelUp: { from: number; to: number } | null = null;

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

/** 경험치 획득 → 퀘스트·배지·레벨업 확인 */
function gainXp(n: number, anchor?: Element | null) {
  const before = levelOf(stats.xp);
  stats = touchStreak({ ...stats, xp: stats.xp + n });
  if (n > 0) floatXp(`+${n} XP`, anchor);
  checkProgress();
  const after = levelOf(stats.xp);
  if (after > before) pendingLevelUp = { from: before, to: after };
  putStats();
}

/** 일일 퀘스트 완료 보상과 배지 획득 */
function checkProgress() {
  stats = fixStats(stats);
  for (const q of QUESTS) {
    if (q.value(stats) >= q.goal && !stats.day.claimed.includes(q.id)) {
      stats.day.claimed = [...stats.day.claimed, q.id];
      stats.xp += q.xp;
      sfx('quest');
      banner(`${q.icon} 퀘스트 완료! ${q.label}`, `+${q.xp} XP`);
    }
  }
  for (const b of BADGES) {
    if (!stats.badges.includes(b.id) && b.test(stats, cards)) {
      stats.badges = [...stats.badges, b.id];
      banner(`${b.icon} 배지 획득: ${b.name}`, b.desc);
    }
  }
}

function toast(msg: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/** 위에서 내려오는 게임 알림 (여러 개면 순서대로) */
let bannerQueue: [string, string][] = [];
let bannerBusy = false;
function banner(title: string, sub: string) {
  bannerQueue.push([title, sub]);
  if (!bannerBusy) nextBanner();
}
function nextBanner() {
  const item = bannerQueue.shift();
  if (!item) { bannerBusy = false; return; }
  bannerBusy = true;
  const el = document.createElement('div');
  el.className = 'banner';
  el.innerHTML = `<b>${esc(item[0])}</b><span>${esc(item[1])}</span>`;
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); nextBanner(); }, 2300);
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
  const left = Math.max(target - card.listens, 0) || target;
  return `
  <div class="player">
    <div class="ring" style="--p:${pct}">
      <button class="play" data-action="play" data-id="${card.id}" aria-label="한 번 듣기">▶</button>
    </div>
    <div class="player-info">
      <div class="count"><b id="listen-count">${card.listens}</b><span>/ ${target}회</span>${card.listens >= target ? '<em class="done-chip">완주</em>' : ''}</div>
      <div class="row tight">
        <button class="btn sm ${looping ? 'red' : 'go'}" data-action="loop" data-id="${card.id}">${looping ? '■ 정지' : `🔁 ${left}회 연속`}</button>
        <button class="btn sm plain" data-action="slow" data-id="${card.id}">🐢 천천히</button>
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

function rarityChip(c: Card) {
  const r = rarity(c);
  return `<span class="rar rar-${r.key}">${r.label}</span>`;
}

function xpBarHTML(xp: number) {
  const lv = levelOf(xp);
  const base = xpForLevel(lv);
  const need = xpForLevel(lv + 1) - base;
  return `<div class="xpbar"><i style="width:${((xp - base) / need) * 100}%"></i><span>${xp - base} / ${need} XP</span></div>`;
}

// ───────────────────────── 홈 ─────────────────────────
function homeView() {
  const due = dueCards();
  const lv = levelOf(stats.xp);
  const f = formIndex(lv);
  const nextForm = FORMS[f + 1];
  const next = cards.filter((c) => !isDue(c)).sort((a, b) => a.due - b.due)[0];
  const rarCount = (k: string) => cards.filter((c) => rarity(c).key === k).length;
  return `
  <section class="profile panel">
    <div class="hero-stage">${heroSVG(lv)}</div>
    <div class="profile-info">
      <div class="lv-row"><span class="lv">Lv.${lv}</span><span class="title-chip">${FORMS[f].title}</span></div>
      ${xpBarHTML(stats.xp)}
      <div class="mini-stats">
        <span class="stat"><b>🔥 ${stats.streak}</b>일 연속</span>
        <span class="stat"><b>🃏 ${cards.length}</b>장 보유</span>
      </div>
      ${nextForm ? `<div class="unlock">Lv.${nextForm.lv}에 <b>${nextForm.item}</b> 해금 → ${nextForm.title}</div>` : '<div class="unlock">최종 형태 도달! 🌏</div>'}
    </div>
  </section>

  <section class="battle panel ${due.length ? 'alert' : ''}">
    ${due.length ? `
      <div class="battle-head"><span class="siren">⚠</span> 망각 몬스터 <b>${due.length}</b>마리 출현!</div>
      <p class="sub">지금 복습하지 않으면 이 표현들이 기억에서 사라져요.</p>
      <div class="mon-row">${due.slice(0, 6).map(() => `<span class="mon-mini">${monsterSVG()}</span>`).join('')}${due.length > 6 ? `<span class="more">+${due.length - 6}</span>` : ''}</div>
      <button class="btn go xl" data-action="start-review">⚔️ 전투 시작</button>` : `
      <div class="battle-head calm">🛡️ 모든 몬스터 처치 완료</div>
      <p class="sub">${next ? `다음 몬스터 출현: <b>${formatDue(next)}</b>` : '첫 표현을 만들면 10분 뒤 첫 몬스터가 나타나요.'}</p>
      <button class="btn xl" data-action="nav" data-view="create">✍️ 새 표현 만들기</button>`}
  </section>

  <section class="panel">
    <h3 class="sec">오늘의 퀘스트 <span class="reset">자정에 초기화</span></h3>
    <div class="quests">${QUESTS.map((q) => {
      const v = Math.min(q.value(stats), q.goal);
      const done = stats.day.claimed.includes(q.id);
      return `<div class="quest ${done ? 'done' : ''}">
        <span class="q-icon">${done ? '✅' : q.icon}</span>
        <div class="q-main"><div class="q-label">${q.label}</div><div class="q-bar"><i style="width:${(v / q.goal) * 100}%"></i></div></div>
        <span class="q-xp">${done ? '완료' : `+${q.xp}`}</span>
      </div>`;
    }).join('')}</div>
  </section>

  <section class="panel">
    <h3 class="sec">표현 도감 <button class="link" data-action="nav" data-view="list">전체 보기 ›</button></h3>
    <div class="rar-grid">
      ${[['common', '일반'], ['uncommon', '고급'], ['rare', '희귀'], ['epic', '영웅'], ['legend', '전설']]
        .map(([k, l]) => `<div class="rar-cell rar-${k}"><b>${rarCount(k)}</b><span>${l}</span></div>`).join('')}
    </div>
    <p class="hint">복습에서 이길 때마다 카드 등급이 올라가요. 전설 = 완전히 내 것이 된 표현.</p>
  </section>

  <section class="panel">
    <h3 class="sec">배지 <span class="reset">${stats.badges.length} / ${BADGES.length}</span></h3>
    <div class="badges">${BADGES.map((b) => {
      const on = stats.badges.includes(b.id);
      return `<div class="badge-i ${on ? 'on' : ''}" title="${esc(b.desc)}"><span>${on ? b.icon : '🔒'}</span><b>${b.name}</b><small>${b.desc}</small></div>`;
    }).join('')}</div>
  </section>`;
}

// ───────────────────────── 만들기 ─────────────────────────
function createView() {
  const d = ui.draft;
  return `
  <section class="panel">
    <h2 class="screen-title">표현 제작소</h2>
    <p class="sub">영어로 하고 싶은 말을 한국어로 쓰거나 말해 보세요.</p>
    <textarea id="ko" rows="3" placeholder="예) 이 도면 검토는 금요일까지 끝낼 수 있을 것 같아요">${esc(ui.draftKo)}</textarea>
    <div class="row">
      ${sttSupported() ? `<button class="btn ${ui.listening ? 'red' : 'plain'}" data-action="mic">${ui.listening ? '■ 그만 듣기' : '🎙️ 말하기'}</button>` : ''}
      <button class="btn go grow" data-action="generate" ${ui.busy ? 'disabled' : ''}>${ui.busy ? '<span class="spin"></span> 제작 중…' : '✨ 영어 표현 만들기'}</button>
    </div>
    ${!aiReady() ? `<p class="warn">먼저 <a href="#" data-action="nav" data-view="settings">설정</a>에서 API 키를 입력해 주세요.</p>` : ''}
    ${ui.error ? `<p class="warn">${esc(ui.error)}</p>` : ''}
  </section>
  ${d ? draftHTML(d) : ''}`;
}

let draftListens = 0;
function draftHTML(d: Expression) {
  const temp: Card = { id: 'draft', ko: ui.draftKo, en: d.en, alts: d.alts, note: d.note_ko, words: d.words, createdAt: 0, ...newCardSchedule(), listens: draftListens };
  return `
  <section class="panel result">
    <div class="en">${sentenceHTML(d.en, 'draft')}</div>
    <p class="hint">👆 모르는 단어를 누르면 뜻이 나와요</p>
    ${playerHTML(temp)}
    ${d.note_ko ? `<p class="note">💡 ${esc(d.note_ko)}</p>` : ''}
    ${altsHTML(d.alts)}
    ${wordChipsHTML(temp)}
    <div class="row">
      <button class="btn plain" data-action="discard">다시 만들기</button>
      <button class="btn go grow" data-action="save">🃏 카드로 획득 <small>+10 XP</small></button>
    </div>
  </section>`;
}

function altsHTML(alts: string[]) {
  if (!alts.length) return '';
  return `<div class="alts"><div class="label">다른 표현</div>${alts
    .map((a) => `<div class="alt"><span>${esc(a)}</span><button class="icon" data-action="say" data-text="${esc(a)}" aria-label="듣기">🔊</button></div>`)
    .join('')}</div>`;
}

// ───────────────────────── 도감 ─────────────────────────
function listItem(c: Card) {
  const r = rarity(c);
  return `<button class="item card-${r.key}" data-action="detail" data-id="${c.id}">
    <span class="gem"></span>
    <div class="item-main"><div class="item-en">${esc(c.en)}</div><div class="item-ko">${esc(c.ko)}</div></div>
    <div class="item-side">${rarityChip(c)}<div class="due ${isDue(c) ? 'now' : ''}">${isDue(c) ? '⚠ 출현 중' : formatDue(c)}</div></div>
  </button>`;
}

function listView() {
  const q = ui.search.trim().toLowerCase();
  const list = cards.filter((c) => !q || c.en.toLowerCase().includes(q) || c.ko.includes(q)).slice().reverse();
  return `
  <section class="panel">
    <h2 class="screen-title">표현 도감 <span class="count-chip">${cards.length}장</span></h2>
    <input id="search" type="search" placeholder="검색 (영어/한국어)" value="${esc(ui.search)}">
  </section>
  <section class="list">${list.length ? list.map(listItem).join('') : '<div class="panel empty">아직 모은 카드가 없어요. 표현 제작소에서 첫 카드를 만들어 보세요.</div>'}</section>`;
}

function detailView() {
  const c = getCard(ui.detailId);
  if (!c) return '<div class="panel">삭제된 표현입니다.</div>';
  const r = rarity(c);
  const isNew = ui.newCardId === c.id;
  return `
  <section class="panel result tcg card-${r.key} ${isNew ? 'reveal' : ''}">
    <div class="tcg-top">${rarityChip(c)}<span class="stage-chip">기억 단계 ${c.stage}/${STAGE_LABELS.length - 1} · ${STAGE_LABELS[c.stage]}</span></div>
    ${isNew ? '<div class="got">NEW CARD!</div>' : ''}
    <div class="ko">${esc(c.ko)}</div>
    <div class="en">${sentenceHTML(c.en, c.id)}</div>
    ${playerHTML(c)}
    ${c.note ? `<p class="note">💡 ${esc(c.note)}</p>` : ''}
    ${altsHTML(c.alts)}
    ${wordChipsHTML(c)}
    <div class="tcg-stats">
      <div><b>${formatDue(c)}</b><span>다음 출현</span></div>
      <div><b>${c.reviews}</b><span>전투</span></div>
      <div><b>${c.lapses}</b><span>패배</span></div>
    </div>
    <div class="row"><button class="btn plain" data-action="nav" data-view="list">← 도감</button><button class="btn red" data-action="delete" data-id="${c.id}">${ui.confirmDelete === c.id ? '정말 삭제? 한 번 더' : '삭제'}</button></div>
  </section>`;
}

// ───────────────────────── 설정 ─────────────────────────
function settingsView() {
  return `
  <section class="panel">
    <h2 class="screen-title">설정</h2>
    ${hasClaude ? `<p class="ok-note">✅ claude.ai 계정으로 연결돼 있어 API 키 없이 쓸 수 있어요. 카드는 내 계정에 저장돼요.</p><input id="apikey" type="hidden" value="${esc(settings.apiKey)}">` : `
    <label for="apikey">Anthropic API 키</label><input id="apikey" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(settings.apiKey)}">
    <p class="hint">키는 이 휴대폰 안에만 저장되고 Anthropic 서버로만 전송돼요.</p>`}
    <label for="rate">읽기 속도 <b id="rate-v">${settings.rate.toFixed(2)}x</b></label><input id="rate" type="range" min="0.5" max="1.2" step="0.05" value="${settings.rate}">
    <label for="target">표현당 목표 듣기 횟수</label><input id="target" type="number" min="1" max="100" value="${settings.listenTarget}">
    <label class="switch"><input id="sound" type="checkbox" ${settings.sound ? 'checked' : ''}> 효과음·진동</label>
    <button class="btn go" data-action="save-settings">저장</button>
    ${!ttsSupported() ? '<p class="warn">이 브라우저는 음성 읽기를 지원하지 않아요.</p>' : ''}
  </section>
  <section class="panel">
    <h3 class="sec">백업</h3>
    <p class="hint">기기를 바꾸거나 브라우저 데이터를 지우기 전에 백업하세요.</p>
    <div class="row"><button class="btn plain" data-action="export">⬇️ 내보내기</button><label class="btn plain" for="import">⬆️ 가져오기</label><input id="import" type="file" accept="application/json" hidden></div>
  </section>
  <section class="panel">
    <h3 class="sec">게임 규칙</h3>
    <p class="hint">사람은 배운 지 하루만 지나도 절반 넘게 잊어요(에빙하우스 망각곡선). 잊기 직전에 떠올리면 기억이 훨씬 오래가요.
    그래서 표현이 잊혀질 때쯤 <b>망각 몬스터</b>로 나타나요. 이기면 다음 출현이 <b>10분 → 1일 → 3일 → 1주 → 2주 → 1달 → 2달</b>로 늦춰지고, 지면 처음부터 다시 나타나요.
    XP는 듣기보다 <b>직접 떠올려 맞혔을 때</b> 가장 많이 받아요.</p>
  </section>`;
}

// ───────────────────────── 전투(복습) ─────────────────────────
function startReview() {
  const due = dueCards().slice(0, 20);
  if (!due.length) return toast('지금은 나타난 몬스터가 없어요');
  stats = fixStats(stats);
  sfx('tap');
  session = {
    queue: due.map((c) => c.id), requeued: new Set(), idx: 0, mode: 'recall', revealed: false,
    combo: 0, xp: 0, done: 0, correct: 0, defeated: 0, startLevel: levelOf(stats.xp), startXp: stats.xp, arena: 'idle',
    tokens: [], picked: [], options: [], answered: null, feedback: '',
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
  // 기억이 굳은 표현일수록 직접 떠올리기(회상) 비중을 높임 — 가장 효과가 큰 복습
  const pool = c.stage >= 3 ? [...modes, 'recall', 'recall'] : modes;
  session.mode = pool[Math.floor(Math.random() * pool.length)] as Mode;
  session.revealed = false;
  session.feedback = '';
  session.answered = null;
  session.picked = [];
  session.arena = 'idle';
  session.tokens = shuffle(words);
  if (session.mode === 'listen') {
    const others = shuffle(cards.filter((x) => x.id !== c.id && x.ko !== c.ko)).slice(0, 3);
    session.options = shuffle([{ ko: c.ko, ok: true }, ...others.map((o) => ({ ko: o.ko, ok: false }))]);
    setTimeout(() => speak(c.en, settings.rate), 350);
  }
}

function arenaHTML(s: Session) {
  const left = s.queue.length - s.idx;
  const mood = s.arena === 'hit' ? 'happy' : s.arena === 'laugh' ? 'sad' : 'idle';
  return `
  <div class="arena">
    <div class="fighter hero-side ${s.arena === 'hit' ? 'jump' : ''}">${heroSVG(levelOf(stats.xp), mood)}</div>
    <div class="vs">${s.combo >= 2 ? `<div class="combo">🔥 ${s.combo} COMBO</div>` : '<span>VS</span>'}</div>
    <div class="fighter mon-side ${s.arena === 'hit' ? 'poof' : s.arena === 'laugh' ? 'shake' : 'float'}">${monsterSVG(s.arena)}</div>
  </div>
  <div class="arena-meta"><span>남은 몬스터 <b>${left}</b></span><span>획득 <b>${s.xp}</b> XP</span></div>`;
}

function reviewView() {
  if (!session) return '';
  if (session.idx >= session.queue.length) return summaryView();
  const s = session;
  const c = getCard(s.queue[s.idx])!;
  const total = s.queue.length;
  const head = `
  <div class="game-head">
    <button class="icon close" data-action="quit" aria-label="그만하기">✕</button>
    <div class="progress"><i style="width:${(s.idx / total) * 100}%"></i></div>
  </div>
  ${arenaHTML(s)}`;
  let body = '';
  if (s.mode === 'recall') {
    body = `
    <div class="q-label">💬 이 말을 영어로 소리 내어 말해 보세요</div>
    <div class="q-ko">${esc(c.ko)}</div>
    ${s.revealed ? `
      <div class="answer"><div class="en">${sentenceHTML(c.en, c.id)}</div>${wordChipsHTML(c)}</div>
      <div class="grades">
        <button class="btn red" data-action="grade" data-g="again">몰랐음<small>곧 다시 출현</small></button>
        <button class="btn amber" data-action="grade" data-g="hard">헷갈림<small>한 번 더</small></button>
        <button class="btn go" data-action="grade" data-g="good">알았음<small>공격!</small></button>
      </div>` : `<button class="btn go xl" data-action="reveal">정답 확인</button>`}`;
  } else if (s.mode === 'scramble') {
    const built = s.picked.map((i) => s.tokens[i]).join(' ');
    body = `
    <div class="q-label">🧱 단어 블록을 순서대로 쌓아 문장을 완성하세요</div>
    <div class="q-ko">${esc(c.ko)}</div>
    <div class="built ${s.feedback}">${esc(built) || '<span class="ph">여기에 문장이 쌓여요</span>'}</div>
    ${s.feedback === 'ng' ? `<div class="answer"><div class="label">정답</div><div class="en">${sentenceHTML(c.en, c.id)}</div></div>` : ''}
    ${s.feedback ? `<button class="btn go xl" data-action="next">다음 ▶</button>` : `
    <div class="pool">${s.tokens.map((t, i) => `<button class="tile" data-action="pick" data-i="${i}" ${s.picked.includes(i) ? 'disabled' : ''}>${esc(t)}</button>`).join('')}</div>
    <div class="row"><button class="btn plain" data-action="undo">↶ 되돌리기</button><button class="btn go grow" data-action="check" ${s.picked.length !== s.tokens.length ? 'disabled' : ''}>공격!</button></div>`}`;
  } else {
    body = `
    <div class="q-label">🎧 듣고 알맞은 뜻을 고르세요</div>
    <button class="big-play" data-action="say" data-text="${esc(c.en)}" aria-label="다시 듣기">🔊</button>
    <div class="opts">${s.options
      .map((o, i) => {
        const cls = s.answered === null ? '' : o.ok ? 'ok' : s.answered === i ? 'ng' : 'dim';
        return `<button class="opt ${cls}" data-action="choose" data-i="${i}" ${s.answered !== null ? 'disabled' : ''}>${esc(o.ko)}</button>`;
      })
      .join('')}</div>
    ${s.answered !== null ? `<div class="answer"><div class="en">${sentenceHTML(c.en, c.id)}</div></div><button class="btn go xl" data-action="next">다음 ▶</button>` : ''}`;
  }
  return `<section class="game">${head}<div class="game-body panel">${body}</div></section>`;
}

function summaryView() {
  const s = session!;
  const acc = s.done ? Math.round((s.correct / s.done) * 100) : 0;
  const stars = acc >= 90 ? 3 : acc >= 70 ? 2 : 1;
  const lv = levelOf(stats.xp);
  return `
  <section class="panel summary">
    <div class="stars">${[1, 2, 3].map((i) => `<span class="star ${i <= stars ? 'on' : ''}" style="--d:${i * 0.18}s">★</span>`).join('')}</div>
    <h2 class="screen-title">전투 승리!</h2>
    <div class="hero-stage sm">${heroSVG(lv, 'happy')}</div>
    <div class="sum-grid">
      <div><b>${s.defeated}</b><span>처치한 몬스터</span></div>
      <div><b>${acc}%</b><span>정확도</span></div>
      <div><b>+${s.xp}</b><span>XP</span></div>
    </div>
    <div class="lv-row center"><span class="lv">Lv.${lv}</span><span class="title-chip">${FORMS[formIndex(lv)].title}</span></div>
    ${xpBarHTML(stats.xp)}
    <p class="hint">이긴 표현은 더 늦게 다시 나타나요. 진 표현은 10분 뒤 다시 도전!</p>
    <button class="btn go xl" data-action="nav" data-view="home">홈으로</button>
  </section>`;
}

function grade(g: Grade) {
  if (!session) return;
  const s = session;
  const id = s.queue[s.idx];
  const c = getCard(id);
  if (!c) return;
  const beforeRar = rarity(c).key;
  const updated = schedule(c, g);
  updateCard(updated);
  s.done++;
  const anchor = document.querySelector('.mon-side');
  if (g === 'good') {
    s.correct++;
    s.defeated++;
    s.combo++;
    stats.day.correct++;
    stats.totals.correct++;
    const gain = 10 + Math.min(s.combo, 10) * 2;
    s.xp += gain;
    if (s.combo > stats.bestCombo) stats.bestCombo = s.combo;
    sfx(s.combo >= 3 ? 'combo' : 'good');
    gainXp(gain, anchor);
    if (rarity(updated).key !== beforeRar) banner('🃏 카드 등급 상승!', `${rarity(updated).label} 등급이 됐어요`);
  } else {
    s.combo = 0;
    const gain = g === 'hard' ? 5 : 2;
    s.xp += gain;
    sfx(g === 'hard' ? 'tap' : 'bad');
    gainXp(gain, anchor);
    if (g === 'again' && !s.requeued.has(id)) {
      s.requeued.add(id);
      s.queue.push(id);
    }
  }
  s.idx++;
  if (s.idx >= s.queue.length) {
    if (s.done >= 5 && s.correct === s.done) { stats.totals.perfect++; checkProgress(); putStats(); }
    confetti();
    sfx('levelup');
  } else setupRound();
  render();
}

/** 답을 보여주는 짧은 연출 후 다음 문제로 */
function showOutcome(ok: boolean) {
  if (!session) return;
  session.arena = ok ? 'hit' : 'laugh';
  sfx(ok ? 'good' : 'bad');
}

// ───────────────────────── 레벨업 연출 ─────────────────────────
function showLevelUp(from: number, to: number) {
  const evolved = formIndex(to) > formIndex(from);
  const f = FORMS[formIndex(to)];
  const el = document.createElement('div');
  el.className = 'levelup';
  el.innerHTML = `
    <div class="lu-card">
      <div class="lu-rays"></div>
      <div class="lu-tag">LEVEL UP</div>
      <div class="lu-lv"><span>Lv.${from}</span> → <b>Lv.${to}</b></div>
      <div class="hero-stage lg">${heroSVG(to, 'happy')}</div>
      ${evolved ? `<div class="lu-evo">진화! <b>${f.item}</b> 해금</div>` : ''}
      <div class="title-chip big">${f.title}</div>
      <button class="btn go xl" data-action="close-levelup">계속하기</button>
    </div>`;
  document.body.appendChild(el);
  sfx('levelup');
  confetti(2400);
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
  stats.totals.listens++;
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
    stats = fixStats(stats);
    stats.day.loops++;
    sfx('quest');
    gainXp(5, document.querySelector('.ring'));
    render();
    flushLevelUp();
  } else putStats();
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
  openSheet(w ? wordHTML(w) : `<div class="sheet-word">${esc(wordKey)}</div><p class="hint"><span class="spin"></span> 사전 찾는 중…</p>`);
  if (w) return;
  if (!aiReady()) return openSheet(`<div class="sheet-word">${esc(wordKey)}</div><p class="warn">API 키가 필요해요.</p>`);
  try {
    w = await lookupWord(settings.apiKey, wordKey, sentence);
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
  <div class="sheet-word">${esc(w.word)} <button class="icon" data-action="say" data-text="${esc(w.lemma || w.word)}" aria-label="듣기">🔊</button></div>
  <div class="hint">${esc(w.ipa)} · ${esc(w.pos)}${w.lemma && norm(w.lemma) !== norm(w.word) ? ` · 기본형 <b>${esc(w.lemma)}</b>` : ''}</div>
  <div class="sheet-mean">${esc(w.meaning_ko)}</div>
  ${w.example_en ? `<div class="sheet-ex"><span>${esc(w.example_en)}</span><button class="icon" data-action="say" data-text="${esc(w.example_en)}" aria-label="듣기">🔊</button></div>` : ''}`;
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
function flushLevelUp() {
  if (pendingLevelUp && !document.querySelector('.levelup')) {
    const { from, to } = pendingLevelUp;
    pendingLevelUp = null;
    setTimeout(() => showLevelUp(from, to), 450);
  }
}

function render() {
  const views: Record<View, () => string> = {
    home: homeView, create: createView, review: reviewView, list: listView, settings: settingsView, detail: detailView,
  };
  const due = dueCards().length;
  const tab = (v: View, icon: string, label: string) =>
    `<button class="tab ${ui.view === v || (v === 'list' && ui.view === 'detail') ? 'on' : ''}" data-action="${v === 'review' ? 'start-review' : 'nav'}" data-view="${v}"><span class="t-icon">${icon}</span><span>${label}</span>${v === 'review' && due ? `<em>${due}</em>` : ''}</button>`;
  app.innerHTML = `
    <main class="${ui.view}">${views[ui.view]()}</main>
    ${ui.view === 'review' ? '' : `<nav class="tabs">${tab('home', '🏠', '홈')}${tab('create', '✍️', '제작')}${tab('review', '⚔️', '전투')}${tab('list', '🃏', '도감')}${tab('settings', '⚙️', '설정')}</nav>`}`;
  // 전투 중에는 문제 사이에 레벨업을 띄우지 않고 결과 화면에서 보여줌
  if (ui.view !== 'review' || !session || session.idx >= session.queue.length) flushLevelUp();
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
      cards.forEach((c) => remoteWrite(c.id, c as unknown as Record<string, unknown>));
      putStats();
      toast(`${cards.length}장의 카드를 가져왔어요`);
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
    case 'nav':
      closeSheet();
      sfx('tap');
      return go(el.dataset.view as View, { newCardId: '', confirmDelete: '' });
    case 'start-review':
      return startReview();
    case 'detail':
      sfx('tap');
      return go('detail', { detailId: el.dataset.id!, newCardId: '', confirmDelete: '' });
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
        sfx('good');
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
      stats = fixStats(stats);
      stats.day.created++;
      stats.totals.created++;
      ui.draft = null;
      ui.draftKo = '';
      sfx('quest');
      go('detail', { detailId: card.id, newCardId: card.id });
      gainXp(10, document.querySelector('.tcg'));
      render();
      return;
    }
    case 'play':
      if (looping) stopLoop();
      return playOnce(el.dataset.id!).then(putStats);
    case 'slow':
      stopLoop();
      return playOnce(el.dataset.id!, Math.max(0.5, settings.rate - 0.25)).then(putStats);
    case 'loop':
      if (looping) { stopLoop(); return render(); }
      return startLoop(el.dataset.id!);
    case 'say':
      return speak(el.dataset.text!, settings.rate);
    case 'word':
      sfx('tap');
      return showWord(el.dataset.word!, el.dataset.card!);
    case 'close-sheet':
      return closeSheet();
    case 'close-levelup':
      document.querySelector('.levelup')?.remove();
      return;
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
        sound: (document.getElementById('sound') as HTMLInputElement).checked,
      };
      setSound(settings.sound);
      saveSettings(settings);
      sfx('tap');
      return toast('저장했어요');
    }
    case 'export': {
      const filename = `english-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const dl = await downloadsCap;
      if (dl) {
        try { await dl.save({ filename, data: exportBackup() }); } catch { /* 사용자가 취소 */ }
        return;
      }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([exportBackup()], { type: 'application/json' }));
      link.download = filename;
      link.click();
      return;
    }
    // ── 전투
    case 'quit':
      session = null;
      return go('home');
    case 'reveal':
      session!.revealed = true;
      sfx('tap');
      render();
      return speak(getCard(session!.queue[session!.idx])!.en, settings.rate);
    case 'grade':
      if (el.dataset.g === 'good') showOutcome(true);
      else if (el.dataset.g === 'again') showOutcome(false);
      render();
      await new Promise((r) => setTimeout(r, 520)); // 공격 연출
      return grade(el.dataset.g as Grade);
    case 'pick':
      session!.picked.push(Number(el.dataset.i));
      sfx('tap');
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
      showOutcome(ok);
      render();
      speak(c.en, settings.rate);
      return;
    }
    case 'choose': {
      const s = session!;
      s.answered = Number(el.dataset.i);
      s.feedback = s.options[s.answered].ok ? 'ok' : 'ng';
      showOutcome(s.feedback === 'ok');
      return render();
    }
    case 'next':
      return grade(session!.feedback === 'ok' ? 'good' : 'again');
  }
});

// 시간이 지나 몬스터가 나타나면 홈 갱신
setInterval(() => { if (ui.view === 'home') render(); }, 60_000);

render();

// 계정 저장소에서 불러오기 (claude.ai 안에서만). 처음이면 이 기기 데이터를 올림
remoteLoadAll().then((remote) => {
  if (!remote) return;
  const remoteCards = Object.entries(remote).filter(([k]) => !k.startsWith('_')).map(([, v]) => v as Card);
  if (remoteCards.length || remote._stats) {
    cards = remoteCards.sort((a, b) => a.createdAt - b.createdAt);
    if (remote._stats) stats = fixStats({ ...stats, ...(remote._stats as typeof stats) });
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
