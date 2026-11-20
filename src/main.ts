import './style.css';
import type { Card, Word } from './types';
import { generateExpression, lookupWord, friendlyError, type Expression } from './api';
import { inArtifact, ttsCap, sampleCap, downloadsCap, remoteWrite, remoteLoadAll, onSync, hasUnsaved, type SyncState } from './platform';
import { mergeCards, mergeStats } from './sync';
import { icon } from './icons';
import { sticker, stickerRaw, STICKERS, GOLD_LEVEL, newlyUnlocked, type StickerName } from './stickers';
import { schedule, isDue, newCardSchedule, formatDue, STAGE_LABELS, type Grade } from './srs';
import { speak, stopSpeaking, listenKorean, stopListening, sttSupported, ttsSupported, unlockSpeech, soundReport, setVoicePref, claudeVoiceAvailable } from './speech';
import {
  loadCards, saveCards, loadStats, saveStats, loadSettings, saveSettings, touchStreak, exportBackup, importBackup, fixStats, loadTombstones, addTombstone, requestPersistentStorage,
} from './store';
import {
  levelOf, xpForLevel, FORMS, formIndex, ballSVG, josa, rarity, QUESTS, BADGES, sfx, setSound, confetti, floatXp, unlockAudio, audioState, mediaModeState,
} from './game';

// ───────────────────────── 상태 ─────────────────────────
type View = 'home' | 'create' | 'review' | 'list' | 'settings' | 'detail';
type Mode = 'recall' | 'scramble' | 'listen';

let cards = loadCards();
let stats = loadStats();
let settings = loadSettings();
setSound(settings.sound);
setVoicePref(settings.voice ?? 'auto');
let sync: SyncState = 'local';
let loaded = false; // 계정 기록 불러오기 끝났는지
onSync((st) => { sync = st; const el = document.getElementById('sync'); if (el) el.outerHTML = syncChip(); });
function syncChip() {
  const m: Record<SyncState, [string, string]> = {
    local: ['phone', '이 기기에만 저장 · 백업 권장'],
    saving: ['⏳', '계정에 저장 중'],
    saved: ['cloud', '계정에 저장됨'],
    retrying: ['warn', '저장 재시도 중 · 연결 확인'],
  };
  return `<button id="sync" class="sync sync-${sync}" data-action="nav" data-view="settings">${icon(m[sync][0])}<span>${m[sync][1]}</span></button>`;
}
let hasClaude = false; // claude.ai 안: 내 Claude 계정으로 호출(API 키 불필요)
sampleCap.then((s) => { hasClaude = !!s; render(); });
ttsCap.then(() => { if (ui.view === 'settings') render(); });
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
  filter: 'all',
  dex: 'cards' as 'cards' | 'stickers' | 'badges',
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
let petTimer: ReturnType<typeof setTimeout> | undefined;
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
const updateCard = (card: Card) => {
  const c = { ...card, updatedAt: Date.now() };
  cards = cards.map((x) => (x.id === c.id ? c : x));
  saveCards(cards);
  remoteWrite(c.id, c as unknown as Record<string, unknown>);
};
const putStats = () => {
  saveStats(stats);
  // 계정 기록을 합치기 전에는 올리지 않음 (계정의 더 큰 XP를 덮어쓰지 않도록)
  if (loaded) remoteWrite('_stats', stats as unknown as Record<string, unknown>);
};
const pet = () => stats.petName || '콩이';
const petGa = () => pet() + josa(pet(), '이', '가');
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
      banner(`퀘스트 완료! ${q.label}`, `+${q.xp} XP`, q.icon);
    }
  }
  for (const b of BADGES) {
    if (!stats.badges.includes(b.id) && b.test(stats, cards)) {
      stats.badges = [...stats.badges, b.id];
      banner(`배지 획득: ${b.name}`, b.desc, b.icon);
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
let bannerQueue: [string, string, string][] = [];
let bannerBusy = false;
function banner(title: string, sub: string, ic = 'sparkle') {
  bannerQueue.push([title, sub, ic]);
  if (!bannerBusy) nextBanner();
}
function nextBanner() {
  const item = bannerQueue.shift();
  if (!item) { bannerBusy = false; return; }
  bannerBusy = true;
  const el = document.createElement('div');
  el.className = 'banner';
  el.innerHTML = `<span class="bn-ic">${icon(item[2])}</span><span class="bn-txt"><b>${esc(item[0])}</b><span>${esc(item[1])}</span></span>`;
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
      <button class="play" data-action="play" data-id="${card.id}" aria-label="한 번 듣기">${icon('play')}</button>
    </div>
    <div class="player-info">
      <div class="count"><b id="listen-count">${card.listens}</b><span>/ ${target}회</span>${card.listens >= target ? '<em class="done-chip">완주</em>' : ''}</div>
      <div class="row tight">
        <button class="btn sm ${looping ? 'red' : 'pink'}" data-action="loop" data-id="${card.id}">${looping ? `${icon('close')} 정지` : `${icon('repeat')} ${left}회 연속`}</button>
        <button class="btn sm plain" data-action="slow" data-id="${card.id}">${icon('slow')} 천천히</button>
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
  const nextSticker = STICKERS.find((x) => x.lv > lv);
  const next = cards.filter((c) => !isDue(c)).sort((a, b) => a.due - b.due)[0];
  const face: StickerName = !cards.length ? 'wink' : due.length ? 'excited' : 'yawn';
  // 퀘스트 = 오늘 할 일. 각 줄을 누르면 바로 그 일을 하러 감
  const questGo: Record<string, string> = { fight: due.length ? 'start-review' : '', make: 'go-create', listen: cards.length ? 'go-list' : 'go-create' };
  return `
  <header class="top-bar">
    <span class="streak">${icon('flame')}<b>${stats.streak}</b>일 연속</span>
    ${sync === 'retrying' || (sync === 'local' && cards.length) ? syncChip() : ''}
    <button class="icon gear" data-action="nav" data-view="settings" aria-label="설정">${icon('gear')}</button>
  </header>

  <section class="home-hero">
    <button class="hero-stage big pettable" data-action="pet" data-face="${face}" aria-label="${esc(pet())} 쓰다듬기">${sticker(face, lv)}</button>
    <div class="pet-line"><b class="pet-name">${esc(pet())}</b><span class="lv-pill">Lv.${lv}</span><span class="title-chip">${FORMS[f].title}</span></div>
    ${xpBarHTML(stats.xp)}
    ${nextSticker ? `<button class="next-sticker" data-action="go-stickers"><span class="ns-thumb">${stickerRaw(nextSticker.name)}${icon('lock', 'ns-lock')}</span><span class="ns-text"><small>다음 스티커</small><b>Lv.${nextSticker.lv}에 '${nextSticker.label}'</b></span>${icon('next')}</button>`
      : `<p class="unlock">${lv >= GOLD_LEVEL ? '모든 스티커와 황금 테두리를 모았어요' : `Lv.${GOLD_LEVEL}에 <b>황금 테두리</b>가 열려요`}</p>`}
  </section>

  <section class="panel today ${due.length ? 'ready' : ''}">
    <h3 class="sec">오늘 할 일 <span class="reset">자정에 초기화</span></h3>
    ${due.length ? `
      <button class="play-cta" data-action="start-review">
        <span class="balls">${due.slice(0, 3).map(() => `<span class="mon-mini">${ballSVG()}</span>`).join('')}</span>
        <span class="pc-text"><b>놀아주기</b><small>잊기 전에 다시 떠올려요</small></span>
        <span class="pc-count">${due.length}</span>
      </button>` : `
      <div class="rest">${stickerRaw('yawn', 'rest-st')}<span>${next ? `다음 놀이는 <b>${formatDue(next)}</b>에 열려요` : '표현을 만들면 10분 뒤 첫 놀이가 열려요'}</span></div>`}
    <div class="quests">${QUESTS.map((q) => {
      const v = Math.min(q.value(stats), q.goal);
      const done = stats.day.claimed.includes(q.id);
      const act = done ? '' : questGo[q.id];
      return `<${act ? 'button' : 'div'} class="quest ${done ? 'done' : ''}" ${act ? `data-action="${act}"` : ''}>
        <span class="q-icon">${icon(done ? 'check' : q.icon)}</span>
        <span class="q-main"><span class="q-label">${q.label}</span><span class="q-bar"><i style="width:${(v / q.goal) * 100}%"></i></span></span>
        <span class="q-xp">${done ? '완료' : `+${q.xp}`}</span>${act ? `<span class="q-go">${icon('next')}</span>` : ''}
      </${act ? 'button' : 'div'}>`;
    }).join('')}</div>
  </section>`;
}

// ───────────────────────── 만들기 ─────────────────────────
const EXAMPLES = ['내일 회의 시간을 조금 미뤄도 될까요?', '그 부분은 제가 확인하고 다시 말씀드릴게요', '오늘 점심 같이 먹을래요?', '천천히 다시 말해 주시겠어요?'];

function createView() {
  const d = ui.draft;
  return `
  <section class="panel maker">
    <div class="maker-head">
      <div class="peek">${sticker(ui.busy ? 'what' : 'wink', levelOf(stats.xp))}</div>
      <div><h2 class="screen-title">표현 만들기</h2><p class="sub">영어로 하고 싶은 말을 한국어로 쓰거나 말해 보세요.</p></div>
    </div>
    <textarea id="ko" rows="3" placeholder="예) ${EXAMPLES[0]}">${esc(ui.draftKo)}</textarea>
    ${!ui.draftKo && !d ? `<div class="examples">${EXAMPLES.slice(1).map((e) => `<button class="ex" data-action="example" data-text="${esc(e)}">${esc(e)}</button>`).join('')}</div>` : ''}
    <div class="row">
      ${sttSupported() ? `<button class="btn ${ui.listening ? 'red' : 'plain'}" data-action="mic">${ui.listening ? `${icon('close')} 그만` : `${icon('mic')} 말하기`}</button>` : ''}
      <button class="btn pink grow" data-action="generate" ${ui.busy ? 'disabled' : ''}>${ui.busy ? `<span class="spin"></span> ${esc(pet())}${josa(pet(), '이', '')}가 생각 중…` : `${icon('sparkle')} 영어로 만들기`}</button>
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
    <p class="hint">점선 단어를 누르면 뜻이 나와요</p>
    ${playerHTML(temp)}
    ${d.note_ko ? `<p class="note">${esc(d.note_ko)}</p>` : ''}
    ${altsHTML(d.alts)}
    ${wordChipsHTML(temp)}
    <div class="row">
      <button class="btn plain" data-action="discard">다시 만들기</button>
      <button class="btn pink grow" data-action="save">카드로 저장 <small>+10 XP</small></button>
    </div>
  </section>`;
}

function altsHTML(alts: string[]) {
  if (!alts.length) return '';
  return `<div class="alts"><div class="label">다른 표현</div>${alts
    .map((a) => `<div class="alt"><span>${esc(a)}</span><button class="icon" data-action="say" data-text="${esc(a)}" aria-label="듣기">${icon('volume')}</button></div>`)
    .join('')}</div>`;
}

// ───────────────────────── 도감 ─────────────────────────
function listItem(c: Card) {
  const r = rarity(c);
  return `<button class="item card-${r.key}" data-action="detail" data-id="${c.id}">
    <span class="gem"></span>
    <div class="item-main"><div class="item-en">${esc(c.en)}</div><div class="item-ko">${esc(c.ko)}</div></div>
    <div class="item-side">${rarityChip(c)}<div class="due ${isDue(c) ? 'now' : ''}">${isDue(c) ? '지금 놀이 대기' : formatDue(c)}</div></div>
  </button>`;
}

function listView() {
  const seg = `<div class="seg" role="tablist">
      <button class="${ui.dex === 'cards' ? 'on' : ''}" data-action="dex" data-d="cards" role="tab">${icon('cards')}카드 ${cards.length}</button>
      <button class="${ui.dex === 'stickers' ? 'on' : ''}" data-action="dex" data-d="stickers" role="tab">${icon('paw')}스티커 ${STICKERS.filter((x) => x.lv <= levelOf(stats.xp)).length}/${STICKERS.length}</button>
      <button class="${ui.dex === 'badges' ? 'on' : ''}" data-action="dex" data-d="badges" role="tab">${icon('medal')}배지 ${stats.badges.length}/${BADGES.length}</button>
    </div>`;
  if (ui.dex === 'stickers') {
    const lv = levelOf(stats.xp);
    return `
    <section class="panel">
      <h2 class="screen-title">도감</h2>${seg}
      <p class="hint">레벨이 오르면 ${esc(petGa())} 새 표정을 보여줘요.${lv >= GOLD_LEVEL ? ' 황금 테두리 획득!' : ` Lv.${GOLD_LEVEL}에는 황금 테두리가 생겨요.`}</p>
      <div class="sticker-grid">${STICKERS.map((x) => {
        const open = lv >= x.lv;
        return `<div class="st-cell ${open ? 'open' : 'locked'}"><span class="tape"></span><span class="st-img">${stickerRaw(x.name, lv >= GOLD_LEVEL && open ? 'gold' : '')}${open ? '' : icon('lock', 'st-lock')}</span><b>${open ? x.label : `Lv.${x.lv}`}</b><small>${x.when}</small></div>`;
      }).join('')}</div>
    </section>`;
  }
  if (ui.dex === 'badges') {
    return `
    <section class="panel">
      <h2 class="screen-title">도감</h2>${seg}
      <div class="badges">${BADGES.map((b) => {
        const on = stats.badges.includes(b.id);
        return `<div class="badge-i ${on ? 'on' : ''}"><span class="medal">${icon(on ? b.icon : 'lock')}</span><b>${b.name}</b><small>${b.desc}</small></div>`;
      }).join('')}</div>
    </section>`;
  }
  const q = ui.search.trim().toLowerCase();
  const f = ui.filter;
  const list = cards
    .filter((c) => !q || c.en.toLowerCase().includes(q) || c.ko.includes(q))
    .filter((c) => f === 'all' || (f === 'due' ? isDue(c) : rarity(c).key === f))
    .slice()
    .reverse();
  const count = (k: string) => (k === 'all' ? cards.length : k === 'due' ? cards.filter(isDue).length : cards.filter((c) => rarity(c).key === k).length);
  const filters: [string, string][] = [['all', '전체'], ['due', '놀이 대기'], ['common', '일반'], ['uncommon', '고급'], ['rare', '희귀'], ['epic', '영웅'], ['legend', '전설']];
  return `
  <section class="panel">
    <h2 class="screen-title">도감</h2>${seg}
    <input id="search" type="search" placeholder="검색 (영어/한국어)" value="${esc(ui.search)}">
    <div class="filters">${filters.map(([k, l]) => `<button class="fchip ${f === k ? 'on' : ''} ${k !== 'all' && k !== 'due' ? `rar-${k}` : ''}" data-action="filter" data-f="${k}">${l} <small>${count(k)}</small></button>`).join('')}</div>
    <p class="hint">놀이에서 공을 물어올 때마다 카드 등급이 올라가요. 전설은 완전히 내 것이 된 표현이에요.</p>
  </section>
  <section class="list">${list.length ? list.map(listItem).join('') : `<div class="panel empty">${cards.length ? '조건에 맞는 카드가 없어요.' : '아직 모은 카드가 없어요. 아래 만들기에서 첫 표현을 만들어 보세요!'}</div>`}</section>`;
}

function detailView() {
  const c = getCard(ui.detailId);
  if (!c) return '<div class="panel">삭제된 표현입니다.</div>';
  const r = rarity(c);
  const isNew = ui.newCardId === c.id;
  return `
  <button class="back" data-action="nav" data-view="list">${icon('back')}도감</button>
  <section class="panel result tcg card-${r.key} ${isNew ? 'reveal' : ''}">
    <div class="tcg-top">${rarityChip(c)}<span class="stage-chip">기억 단계 ${c.stage}/${STAGE_LABELS.length - 1} · ${STAGE_LABELS[c.stage]}</span></div>
    ${isNew ? `<div class="got-wrap"><div class="peek">${sticker('surprised', levelOf(stats.xp), 'swap')}</div><div class="got">새 카드 획득!</div></div>` : ''}
    <div class="ko">${esc(c.ko)}</div>
    <div class="en">${sentenceHTML(c.en, c.id)}</div>
    ${playerHTML(c)}
    ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
    ${altsHTML(c.alts)}
    ${wordChipsHTML(c)}
    <div class="tcg-stats">
      <div><b>${formatDue(c)}</b><span>다음 놀이</span></div>
      <div><b>${c.reviews}</b><span>놀이</span></div>
      <div><b>${c.lapses}</b><span>놓침</span></div>
    </div>
    <button class="del ${ui.confirmDelete === c.id ? 'armed' : ''}" data-action="delete" data-id="${c.id}">${ui.confirmDelete === c.id ? '정말 삭제할까요? 한 번 더 누르면 삭제돼요' : '이 카드 삭제'}</button>
  </section>`;
}

// ───────────────────────── 설정 ─────────────────────────
function soundStatusHTML() {
  const d = soundReport();
  const ok = d.engine !== 'none' && !(d.fail > 0 && d.ok === 0);
  const row = (k: string, v: string, bad = false) => `<div class="dg-row ${bad ? 'bad' : ''}"><span>${k}</span><b>${esc(v)}</b></div>`;
  return `<div class="sound-box ${ok ? '' : 'bad'}">
    <div class="dg">
      ${row('지금 쓰는 음성', d.engine === 'claude' ? 'Claude 음성' : d.engine === 'browser' ? '휴대폰 음성' : '없음', d.engine === 'none')}
      ${row('기기 · 열린 곳', `${d.device} · ${d.place}`, d.place === '앱 안 화면')}
      ${row('영어 음성', d.synth ? `${d.enVoices}개 (전체 ${d.voices}개)` : '없음', !d.synth || d.enVoices === 0)}
      ${row('Claude 음성', d.claude ? '사용 가능' : '이 화면에선 안 됨')}
      ${row('효과음 엔진', audioState())}
      ${row('무음 모드 우회', mediaModeState, mediaModeState.startsWith('켜기 실패'))}
      ${row('마지막 재생', d.last, d.fail > 0 && d.ok === 0)}
    </div>
    <div class="row tight">
      <button class="btn sm go" data-action="sound-test">${icon('volume')} 영어 소리 테스트</button>
      <button class="btn sm plain" data-action="sfx-test">${icon('bell')} 효과음 테스트</button>
    </div>
  </div>
  <details class="sound-help" ${!ok || d.place === '앱 안 화면' ? 'open' : ''}>
    <summary>재생 성공인데 소리가 안 들리면?</summary>
    ${soundHelpHTML()}
  </details>`;
}

function soundHelpHTML() {
  return `<ul class="help">
    <li><b>Claude 앱 안에서 열었다면</b> → 이 링크를 복사해서 <b>크롬(안드로이드)</b>이나 <b>사파리(아이폰)</b>에 붙여 넣어 열어 주세요. 앱 안 화면은 음성 읽기를 막는 경우가 많아요.</li>
    <li><b>아이폰</b>: <b>무음 모드를 꺼 주세요.</b> 옆면 스위치(빨간색이 보이면 무음), 또는 제어 센터의 종 모양 버튼이에요. 그다음 소리가 나는 동안 음량 버튼(+)을 눌러 주세요.</li>
    <li><b>안드로이드</b>: 설정 › 일반 관리 › 텍스트 음성 변환에서 <b>Google 음성 엔진</b>을 고르고 영어 음성 데이터를 설치해 주세요.</li>
    <li>그래도 안 되면 이 상자를 캡처해서 보내 주세요. 원인을 바로 찾을 수 있어요.</li>
  </ul>`;
}

function settingsView() {
  return `
  <button class="back" data-action="nav" data-view="home">${icon('back')}홈</button>
  <section class="panel">
    <h2 class="screen-title">설정</h2>
    <p class="hint">바꾸면 바로 저장돼요.</p>
    <h3 class="sub-h">${icon('volume')}소리</h3>
    <div class="seg voice-seg" role="radiogroup" aria-label="영어 읽기 음성">
      ${([['auto', '자동'], ['claude', 'Claude 음성'], ['device', '휴대폰 음성']] as const).map(([k, l]) =>
        `<button class="${(settings.voice ?? 'auto') === k ? 'on' : ''}" data-action="voice" data-v="${k}" role="radio" aria-checked="${(settings.voice ?? 'auto') === k}" ${k === 'claude' && !claudeVoiceAvailable() ? 'disabled' : ''}>${l}</button>`).join('')}
    </div>
    <p class="hint">${claudeVoiceAvailable() ? '자동: Claude 음성을 먼저 쓰고, 안 되면 휴대폰 음성으로 바꿔요.' : '이 화면에서는 Claude 음성을 쓸 수 없어 휴대폰 음성을 써요. (사파리·모바일 앱은 Claude 음성 미지원)'}</p>
    ${soundStatusHTML()}
    <label for="rate">읽기 속도 <b id="rate-v">${settings.rate.toFixed(2)}x</b></label><input id="rate" type="range" min="0.5" max="1.2" step="0.05" value="${settings.rate}">
    <label for="target">표현당 목표 듣기 횟수</label><input id="target" type="number" min="1" max="100" value="${settings.listenTarget}">
    <label class="switch"><input id="sound" type="checkbox" ${settings.sound ? 'checked' : ''}> 효과음·진동</label>
    <h3 class="sub-h">${icon('paw')}강아지 이름</h3>
    <input id="petname" type="text" maxlength="10" value="${esc(pet())}" aria-label="강아지 이름">
    ${hasClaude ? '' : `
    <h3 class="sub-h">${icon('sparkle')}Claude API 키</h3>
    <input id="apikey" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(settings.apiKey)}" aria-label="Anthropic API 키">
    <p class="hint">키는 이 휴대폰 안에만 저장되고 Anthropic 서버로만 전송돼요.</p>`}
  </section>
  <section class="panel">
    <h3 class="sec">학습 기록 ${syncChip()}</h3>
    <div class="rec-grid"><div><b>${cards.length}</b><span>카드</span></div><div><b>${stats.totals.correct}</b><span>누적 정답</span></div><div><b>${stats.totals.listens}</b><span>누적 듣기</span></div></div>
    <p class="hint">${sync === 'local'
      ? '지금은 이 기기 브라우저에만 저장돼요. 브라우저 데이터를 지우면 사라지니 가끔 내보내기로 백업하세요.'
      : 'claude.ai 계정에 저장돼서 다시 열어도, 다른 기기에서 열어도 기록이 이어져요.'}</p>
    <div class="row"><button class="btn plain grow" data-action="export">${icon('download')} 내보내기</button><label class="btn plain grow" for="import">${icon('upload')} 가져오기</label><input id="import" type="file" accept="application/json" hidden></div>
  </section>
  <details class="panel rules">
    <summary>놀이 규칙 (망각곡선)</summary>
    <p class="hint">사람은 배운 지 하루만 지나도 절반 넘게 잊어요. 잊기 직전에 떠올리면 기억이 훨씬 오래가요.
    그래서 표현이 잊혀질 때쯤 <b>공</b>이 되어 ${esc(petGa())} 놀자고 해요. 떠올려 맞히면 다음 놀이가 <b>10분 → 1일 → 3일 → 1주 → 2주 → 1달 → 2달</b> 뒤로 늦춰지고, 놓치면 10분 뒤 다시 나와요.
    XP는 듣기보다 <b>직접 떠올려 맞혔을 때</b> 가장 많이 받아요.</p>
  </details>`;
}

/** 설정 화면 입력값을 바로 저장 */
function saveSettingsFromForm() {
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null);
  settings = {
    apiKey: val('apikey')?.value.trim() ?? settings.apiKey,
    rate: Number(val('rate')?.value ?? settings.rate),
    listenTarget: Math.max(1, Math.min(100, Number(val('target')?.value) || 20)),
    sound: val('sound')?.checked ?? settings.sound,
    voice: settings.voice ?? 'auto',
  };
  setSound(settings.sound);
  saveSettings(settings);
  const nm = val('petname')?.value.trim();
  if (nm && nm !== pet()) { stats = { ...stats, petName: nm.slice(0, 10) }; putStats(); }
}

// ───────────────────────── 놀이(복습) ─────────────────────────
function startReview() {
  const due = dueCards().slice(0, 20);
  if (!due.length) return toast(`${petGa()} 지금은 낮잠 중이에요. 놀 공이 없어요`);
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
  return `
  <div class="arena">
    <div class="fighter hero-side ${s.arena === 'hit' ? 'jump' : s.arena === 'laugh' ? 'shake' : ''}">${sticker(s.arena === 'hit' ? 'happy' : s.arena === 'laugh' ? 'angry' : 'excited', levelOf(stats.xp), s.arena !== 'idle' ? 'swap' : '')}</div>
    <div class="vs">${s.combo >= 2 ? `<div class="combo">${icon('flame')}${s.combo} COMBO</div>` : '<span class="dots">· · ·</span>'}</div>
    <div class="fighter mon-side ${s.arena === 'hit' ? 'fetch' : s.arena === 'laugh' ? 'rollaway' : 'float'}">${ballSVG()}</div>
  </div>
  <div class="arena-meta"><span>남은 공 <b>${left}</b></span><span>획득 <b>${s.xp}</b> XP</span></div>`;
}

function reviewView() {
  if (!session) return '';
  if (session.idx >= session.queue.length) return summaryView();
  const s = session;
  const c = getCard(s.queue[s.idx])!;
  const total = s.queue.length;
  const head = `
  <div class="game-head">
    <button class="icon close" data-action="quit" aria-label="그만하기">${icon('close')}</button>
    <div class="progress"><i style="width:${(s.idx / total) * 100}%"></i></div>
  </div>
  ${arenaHTML(s)}`;
  let body = '';
  if (s.mode === 'recall') {
    body = `
    <div class="q-label">${icon('mic')}이 말을 영어로 소리 내어 말해 보세요</div>
    <div class="q-ko">${esc(c.ko)}</div>
    ${s.revealed ? `
      <div class="answer"><div class="en">${sentenceHTML(c.en, c.id)}</div>${wordChipsHTML(c)}</div>
      <div class="grades">
        <button class="btn red" data-action="grade" data-g="again">몰랐음<small>곧 다시 던져줘요</small></button>
        <button class="btn amber" data-action="grade" data-g="hard">헷갈림<small>한 번 더</small></button>
        <button class="btn go" data-action="grade" data-g="good">알았음<small>물어와!</small></button>
      </div>` : `<button class="btn go xl" data-action="reveal">정답 확인</button>`}`;
  } else if (s.mode === 'scramble') {
    const built = s.picked.map((i) => s.tokens[i]).join(' ');
    body = `
    <div class="q-label">${icon('cards')}단어를 순서대로 눌러 문장을 완성하세요</div>
    <div class="q-ko">${esc(c.ko)}</div>
    <div class="built ${s.feedback}">${esc(built) || '<span class="ph">여기에 문장이 쌓여요</span>'}</div>
    ${s.feedback === 'ng' ? `<div class="answer"><div class="label">정답</div><div class="en">${sentenceHTML(c.en, c.id)}</div></div>` : ''}
    ${s.feedback ? `<button class="btn go xl" data-action="next">다음 ${icon('next')}</button>` : `
    <div class="pool">${s.tokens.map((t, i) => `<button class="tile" data-action="pick" data-i="${i}" ${s.picked.includes(i) ? 'disabled' : ''}>${esc(t)}</button>`).join('')}</div>
    <div class="row"><button class="btn plain" data-action="undo">${icon('back')} 되돌리기</button><button class="btn go grow" data-action="check" ${s.picked.length !== s.tokens.length ? 'disabled' : ''}>던지기!</button></div>`}`;
  } else {
    body = `
    <div class="q-label">${icon('headphones')}듣고 알맞은 뜻을 고르세요</div>
    <button class="big-play" data-action="say" data-text="${esc(c.en)}" aria-label="다시 듣기">${icon('volume')}</button>
    <div class="opts">${s.options
      .map((o, i) => {
        const cls = s.answered === null ? '' : o.ok ? 'ok' : s.answered === i ? 'ng' : 'dim';
        return `<button class="opt ${cls}" data-action="choose" data-i="${i}" ${s.answered !== null ? 'disabled' : ''}>${esc(o.ko)}</button>`;
      })
      .join('')}</div>
    ${s.answered !== null ? `<div class="answer"><div class="en">${sentenceHTML(c.en, c.id)}</div></div><button class="btn go xl" data-action="next">다음 ${icon('next')}</button>` : ''}`;
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
    <h2 class="screen-title">놀이 끝!</h2><p class="sub">${esc(petGa())} 공을 ${s.defeated}개나 물어왔어요</p>
    <div class="hero-stage big">${sticker(stars >= 2 ? 'happy' : 'what', lv, 'swap')}</div>
    <div class="sum-grid">
      <div><b>${s.defeated}</b><span>물어온 공</span></div>
      <div><b>${acc}%</b><span>정확도</span></div>
      <div><b>+${s.xp}</b><span>XP</span></div>
    </div>
    <div class="lv-row center"><span class="lv">Lv.${lv}</span><span class="title-chip">${FORMS[formIndex(lv)].title}</span></div>
    ${xpBarHTML(stats.xp)}
    <p class="hint">물어온 공(표현)은 더 나중에 다시 놀자고 해요. 놓친 공은 10분 뒤에 다시 던져줘요.</p>
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
    if (rarity(updated).key !== beforeRar) banner('카드 등급 상승!', `${rarity(updated).label} 등급이 됐어요`, 'card');
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
  const fresh = newlyUnlocked(from, to);
  const f = FORMS[formIndex(to)];
  const el = document.createElement('div');
  el.className = 'levelup';
  el.innerHTML = `
    <div class="lu-card">
      <div class="lu-rays"></div>
      <div class="lu-tag">LEVEL UP</div>
      <div class="lu-lv"><span>Lv.${from}</span> → <b>Lv.${to}</b></div>
      <div class="hero-stage big">${fresh.length ? stickerRaw(fresh[0].name, 'swap') : sticker('cool', to, 'swap')}</div>
      ${fresh.length ? `<div class="lu-evo">새 스티커 획득! <b>'${fresh[0].label}'</b></div>` : to >= GOLD_LEVEL && from < GOLD_LEVEL ? '<div class="lu-evo">황금 테두리 획득!</div>' : ''}
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
  <div class="sheet-word">${esc(w.word)} <button class="icon" data-action="say" data-text="${esc(w.lemma || w.word)}" aria-label="듣기">${icon('volume')}</button></div>
  <div class="hint">${esc(w.ipa)} · ${esc(w.pos)}${w.lemma && norm(w.lemma) !== norm(w.word) ? ` · 기본형 <b>${esc(w.lemma)}</b>` : ''}</div>
  <div class="sheet-mean">${esc(w.meaning_ko)}</div>
  ${w.example_en ? `<div class="sheet-ex"><span>${esc(w.example_en)}</span><button class="icon" data-action="say" data-text="${esc(w.example_en)}" aria-label="듣기">${icon('volume')}</button></div>` : ''}`;
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
  const active: Partial<Record<View, View>> = { detail: 'list', settings: 'home' };
  const tab = (v: View, ic: string, label: string, badge = 0, cls = '') =>
    `<button class="tab ${cls} ${(active[ui.view] ?? ui.view) === v ? 'on' : ''}" data-action="nav" data-view="${v}"><span class="t-icon">${icon(ic)}</span><span>${label}</span>${badge ? `<em>${badge}</em>` : ''}</button>`;
  app.innerHTML = `
    <main class="${ui.view}">${views[ui.view]()}</main>
    ${ui.view === 'review' ? '' : `<nav class="tabs"><div class="tabs-inner">${tab('home', 'home', '홈', ui.view === 'home' ? 0 : due)}${tab('create', 'pen', '만들기', 0, 'center')}${tab('list', 'cards', '도감')}</div></nav>`}`;
  // 놀이 중에는 문제 사이에 레벨업을 띄우지 않고 결과 화면에서 보여줌
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
  if (['rate', 'target', 'sound', 'petname', 'apikey'].includes(t.id)) saveSettingsFromForm();
});

app.addEventListener('change', async (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'sound') saveSettingsFromForm();
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
      return go(el.dataset.view as View, { newCardId: '', confirmDelete: '', filter: el.dataset.view === 'list' ? 'all' : ui.filter });
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
        words: ui.draft.words, createdAt: Date.now(), ...newCardSchedule(), listens: draftListens, updatedAt: Date.now(),
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
    case 'pet': {
      sfx('bark');
      floatXp('♥', el);
      const back = el.dataset.face as StickerName;
      el.innerHTML = sticker('love', levelOf(stats.xp), 'swap petted');
      clearTimeout(petTimer);
      petTimer = setTimeout(() => { if (el.isConnected) el.innerHTML = sticker(back, levelOf(stats.xp), 'swap'); }, 1600);
      return;
    }
    case 'example':
      ui.draftKo = el.dataset.text!;
      return render();
    case 'filter':
      sfx('tap');
      return go('list', { filter: el.dataset.f!, dex: 'cards' });
    case 'dex':
      sfx('tap');
      ui.dex = el.dataset.d as 'cards' | 'stickers' | 'badges';
      return render();
    case 'go-stickers':
      return go('list', { dex: 'stickers' });
    case 'go-create':
      return go('create');
    case 'go-list':
      return go('list', { filter: 'all', dex: 'cards' });
    case 'sound-test':
      el.textContent = '재생 중…';
      speak('Hello! Let\'s learn English together.', settings.rate).then(() => { if (ui.view === 'settings') render(); });
      setTimeout(() => { if (ui.view === 'settings') render(); }, 3300);
      return;
    case 'voice': {
      settings = { ...settings, voice: el.dataset.v as 'auto' | 'claude' | 'device' };
      saveSettings(settings);
      setVoicePref(settings.voice!);
      sfx('tap');
      return render();
    }
    case 'sfx-test':
      setSound(true);
      sfx('levelup');
      setSound(settings.sound);
      setTimeout(() => { if (ui.view === 'settings') render(); }, 300);
      return;
    case 'close-levelup':
      document.querySelector('.levelup')?.remove();
      return;
    case 'delete': {
      const id = el.dataset.id!;
      if (ui.confirmDelete !== id) { ui.confirmDelete = id; return render(); }
      cards = cards.filter((c) => c.id !== id);
      saveCards(cards);
      addTombstone(id);
      remoteWrite(id, null);
      return go('list', { confirmDelete: '' });
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
    // ── 놀이(복습)
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
      await new Promise((r) => setTimeout(r, 520)); // 공 물어오기 연출
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

// 첫 터치 때 소리 잠금 해제 (모바일은 탭 안에서 한 번 소리를 깨워야 함)
document.addEventListener('pointerdown', () => { unlockSpeech(); unlockAudio(); }, { capture: true });
document.addEventListener('touchend', () => { unlockSpeech(); unlockAudio(); }, { capture: true });

// 영어 음성을 낼 수 없으면 한 번 안내
let soundHelpShown = false;
window.addEventListener('speech-unavailable', () => {
  if (soundHelpShown) return;
  soundHelpShown = true;
  openSheet(`<div class="sheet-word">영어 음성이 안 나와요</div><p class="hint">이 화면에서는 휴대폰이 영어 읽기를 막고 있어요. 아래 방법으로 해결할 수 있어요.</p>${soundHelpHTML()}<button class="btn go xl" data-action="close-sheet">알겠어요</button>`);
});

// 놀이 시간이 되면 홈 갱신
setInterval(() => { if (ui.view === 'home') render(); }, 60_000);

render();

// 계정 기록과 이 기기 기록을 합치기 (claude.ai 안에서만). 어느 쪽도 버리지 않음
requestPersistentStorage();
remoteLoadAll().then((remote) => {
  loaded = true;
  if (!remote) return;
  const remoteCards = Object.entries(remote).filter(([k]) => !k.startsWith('_')).map(([, v]) => v as Card);
  const { merged, toUpload } = mergeCards(cards, remoteCards, loadTombstones());
  cards = merged;
  stats = remote._stats ? mergeStats(stats, remote._stats as Partial<typeof stats>) : stats;
  saveCards(cards);
  saveStats(stats);
  toUpload.forEach((c) => remoteWrite(c.id, c as unknown as Record<string, unknown>));
  for (const id of loadTombstones()) if (remote[id]) remoteWrite(id, null);
  putStats();
  render();
});

// 저장이 끝나기 전에 닫으려 하면 경고
addEventListener('beforeunload', (e) => { if (hasUnsaved()) e.preventDefault(); });

if ('serviceWorker' in navigator && import.meta.env.PROD && !inArtifact) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
