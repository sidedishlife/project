// claude.ai 아티팩트 안에서 실행될 때 쓰는 플랫폼 기능(있으면 사용, 없으면 null).
// - sample: 사용자의 Claude 계정으로 Claude에게 질문 → API 키 불필요
// - dictation: 음성 → 텍스트
// - tts: Claude 음성으로 읽기
// - db + user: 내 표현을 계정에 저장(기기/브라우저가 바뀌어도 유지)
// - downloads: 백업 파일 저장
type Any = any;
const C: Any = (window as Any).claude;

function use(name: string): Promise<Any | null> {
  if (!C?.use) return Promise.resolve(null);
  return C.use(name).catch(() => null);
}

export const inArtifact = !!C?.use;
export const sampleCap = use('sample');
export const dictationCap = use('dictation');
export const ttsCap = use('tts');
export const downloadsCap = use('downloads');

/** 계정 저장소: data/users/<내 id>/<문서>  (본인만 읽고 쓸 수 있는 영역) */
export const deckCap: Promise<{ col: Any } | null> = (async () => {
  const [db, user] = await Promise.all([use('db'), use('user')]);
  if (!db || !user) return null;
  const id = await user.id().catch(() => null);
  if (!id) return null;
  return { col: db.collection(`data/users/${id}`) };
})();

// ── 계정 저장: 문서마다 최신 값만 보관했다가 차례로 저장, 실패하면 다시 시도
export type SyncState = 'local' | 'saving' | 'saved' | 'retrying';
let syncState: SyncState = 'local';
const listeners = new Set<(s: SyncState) => void>();
export const onSync = (fn: (s: SyncState) => void) => { listeners.add(fn); fn(syncState); };
const setSync = (s: SyncState) => { syncState = s; listeners.forEach((f) => f(s)); };
deckCap.then((d) => setSync(d ? 'saved' : 'local'));

const dirty = new Map<string, Record<string, unknown> | null>(); // null = 삭제
let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function remoteWrite(docId: string, data: Record<string, unknown> | null) {
  dirty.set(docId, data === null ? null : JSON.parse(JSON.stringify(data)));
  void flush();
}

async function flush() {
  if (flushing) return;
  const deck = await deckCap;
  if (!deck) return; // 계정 저장소 없음: 이 기기에만 저장
  flushing = true;
  setSync('saving');
  let failed = false;
  while (dirty.size) {
    const [id, data] = dirty.entries().next().value as [string, Record<string, unknown> | null];
    dirty.delete(id);
    try {
      const ref = deck.col.doc(id);
      if (data === null) await ref.delete();
      else await ref.set(data);
    } catch (e) {
      console.warn('저장 실패, 다시 시도 예정', id, e);
      if (!dirty.has(id)) dirty.set(id, data); // 더 새 값이 없으면 다시 넣기
      failed = true;
      break;
    }
  }
  flushing = false;
  if (failed) {
    setSync('retrying');
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void flush(), 15_000);
  } else setSync(dirty.size ? 'saving' : 'saved');
}
addEventListener('online', () => void flush());
/** 저장 안 된 변경이 있는지 (창 닫기 경고용) */
export const hasUnsaved = () => dirty.size > 0;

export async function remoteLoadAll(): Promise<Record<string, Any> | null> {
  const deck = await deckCap;
  if (!deck) return null;
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 10_000));
  const snap = await Promise.race([deck.col.get().catch(() => null), timeout]);
  if (!snap) return null;
  const out: Record<string, Any> = {};
  for (const d of snap.docs) if (d.exists) out[d.id] = d.data();
  return out;
}
