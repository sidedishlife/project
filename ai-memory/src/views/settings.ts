import { api } from '../api';
import { h, errText } from '../dom';
import { getTheme, setTheme, type Theme } from '../theme';
import { canEnablePush, enablePush, isStandalone } from '../push';

type Slots = { morning: string; evening: string; bedtime: string };
type Config = { ai_model: string; daily_goal: number; slots: Slots; mask_enabled: boolean; mcp_url: string | null };
type Term = { term: string; alias: string };

const patch = (body: Record<string, unknown>) => api<Config>('/config', { method: 'PATCH', body: JSON.stringify(body) });

function section(title: string, ...kids: (Node | null)[]) { return h('section', { class: 'card' }, h('h2', {}, title), ...kids); }

/** 저장 결과를 한 줄로 알려 주는 작은 상태 표시 */
function status() {
  const p = h('p', { class: 'hint', role: 'status' });
  return Object.assign(p, { ok: (t: string) => { p.className = 'hint'; p.textContent = t; }, fail: (e: unknown) => { p.className = 'error'; p.textContent = errText(e); } });
}

export async function renderSettings(root: HTMLElement): Promise<void> {
  const [cfg, { terms }] = await Promise.all([api<Config>('/config'), api<{ terms: Term[] }>('/mask-terms')]);
  root.replaceChildren(mcpSection(cfg), goalSection(cfg), slotsSection(cfg), pushSection(), maskSection(cfg, terms), themeSection());
}

function mcpSection(cfg: Config): HTMLElement {
  const url = h('input', { readonly: true, value: cfg.mcp_url ?? '', 'aria-label': 'MCP 주소' });
  const st = status();
  const copy = h('button', { class: 'primary', onclick: async () => {
    try { await navigator.clipboard.writeText(url.value); st.ok('복사했어요'); } catch { url.select(); st.ok('주소를 길게 눌러 복사해 주세요'); }
  } }, '주소 복사');
  const rotate = h('button', { onclick: async () => {
    if (!confirm('비밀값을 새로 만들면 이전 주소는 더 이상 쓸 수 없어요. 계속할까요?')) return;
    try { const r = await api<{ mcp_url: string }>('/config/rotate-mcp', { method: 'POST', body: '{}' }); url.value = r.mcp_url; st.ok('새 주소로 바꿨어요. AI 앱에 다시 붙여넣어 주세요'); } catch (e) { st.fail(e); }
  } }, '비밀값 재발급');
  return section('AI 연결 (MCP 주소)',
    cfg.mcp_url ? url : h('p', { class: 'hint' }, '아직 주소가 없어요. 비밀값 재발급을 눌러 만들어요.'),
    h('div', { class: 'actions' }, cfg.mcp_url ? copy : null, rotate), st,
    h('ol', { class: 'guide' },
      h('li', {}, 'Claude.ai: 설정 › 커넥터 › 커스텀 커넥터 추가에 주소 붙여넣기'),
      h('li', {}, 'ChatGPT(Plus): 설정 › 앱 › 고급 › 개발자 모드 켜고 주소 끝에 ?from=chatgpt 붙여 추가'),
      h('li', {}, '대화 끝에 "기억장에 저장해"라고 말하기')));
}

function goalSection(cfg: Config): HTMLElement {
  const input = h('input', { type: 'number', min: '1', max: '50', value: String(cfg.daily_goal), inputmode: 'numeric', 'aria-label': '하루 목표' });
  const st = status();
  const save = h('button', { onclick: async () => {
    const n = Number(input.value);
    if (!Number.isInteger(n) || n < 1 || n > 50) return st.fail(new Error('1~50 사이 숫자로 입력해 주세요'));
    try { await patch({ daily_goal: n }); st.ok('저장했어요'); } catch (e) { st.fail(e); }
  } }, '저장');
  return section('하루 목표 (개)', input, save, st);
}

function slotsSection(cfg: Config): HTMLElement {
  const mk = (label: string, v: string) => h('input', { type: 'time', value: v, 'aria-label': label });
  const m = mk('아침', cfg.slots.morning), e = mk('저녁', cfg.slots.evening), b = mk('자기 전', cfg.slots.bedtime);
  const st = status();
  const save = h('button', { onclick: async () => {
    if (!m.value || !e.value || !b.value) return st.fail(new Error('시각을 모두 입력해 주세요'));
    try { await patch({ slots: { morning: m.value, evening: e.value, bedtime: b.value } }); st.ok('저장했어요'); } catch (x) { st.fail(x); }
  } }, '저장');
  return section('알림 시각', h('label', {}, '아침', m), h('label', {}, '저녁', e), h('label', {}, '자기 전', b), save, st);
}

function pushSection(): HTMLElement {
  const st = status();
  const btn = h('button', { class: 'primary', onclick: async () => {
    try {
      const r = await enablePush();
      if (r === 'ok') st.ok('알림을 켰어요');
      else if (r === 'need-home-screen') st.fail(new Error('홈 화면에 추가 후 열어주세요'));
      else st.fail(new Error('이 브라우저는 알림을 지원하지 않아요'));
    } catch (e) { st.fail(e); }
  } }, '알림 켜기');
  const pre = canEnablePush(navigator, isStandalone());
  if (pre === 'need-home-screen') st.fail(new Error('홈 화면에 추가 후 열어주세요'));
  else if (pre === 'unsupported') st.fail(new Error('이 브라우저는 알림을 지원하지 않아요'));
  return section('알림', btn, st);
}

function maskSection(cfg: Config, initial: Term[]): HTMLElement {
  const rows = h('div', { class: 'mask-rows' });
  const st = status();
  const addRow = (t: Term = { term: '', alias: '' }) => {
    const term = h('input', { value: t.term, placeholder: '가릴 말', 'aria-label': '가릴 말' });
    const alias = h('input', { value: t.alias, placeholder: '바꿀 말', 'aria-label': '바꿀 말' });
    const row = h('div', { class: 'mask-row' }, term, alias, h('button', { 'aria-label': '삭제', onclick: () => row.remove() }, '삭제'));
    rows.append(row);
  };
  initial.forEach(addRow);
  const sw = h('input', { type: 'checkbox', role: 'switch', 'aria-label': '가리기' });
  sw.checked = cfg.mask_enabled;
  const save = h('button', { class: 'primary', onclick: async () => {
    const terms = [...rows.querySelectorAll('.mask-row')]
      .map((r) => { const i = r.querySelectorAll('input'); return { term: i[0].value.trim(), alias: i[1].value.trim() }; })
      .filter((t) => t.term || t.alias);
    try {
      await api('/mask-terms', { method: 'PUT', body: JSON.stringify({ terms }) });
      await patch({ mask_enabled: sw.checked });
      st.ok('저장했어요');
    } catch (e) { st.fail(e); }
  } }, '저장');
  return section('가리기',
    h('p', { class: 'hint' }, 'AI로 보내기 전에 아래 말을 다른 말로 바꿔요.'),
    h('label', { class: 'switch' }, sw, ' 가리기 켜기'), rows,
    h('div', { class: 'actions' }, h('button', { onclick: () => addRow() }, '항목 추가'), save), st);
}

function themeSection(): HTMLElement {
  const sel = h('select', { 'aria-label': '화면 색' },
    h('option', { value: 'auto' }, '시스템 설정 따르기'), h('option', { value: 'light' }, '밝게'), h('option', { value: 'dark' }, '어둡게'));
  sel.value = getTheme();
  sel.addEventListener('change', () => setTheme(sel.value as Theme));
  return section('화면 색', sel);
}
