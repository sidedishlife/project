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

// 같은 문서에는 한 번에 하나씩 쓰기
const chains = new Map<string, Promise<unknown>>();
export function remoteWrite(docId: string, data: Record<string, unknown> | null) {
  const prev = chains.get(docId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const deck = await deckCap;
    if (!deck) return;
    const ref = deck.col.doc(docId);
    if (data === null) await ref.delete();
    else await ref.set(JSON.parse(JSON.stringify(data)));
  }).catch((e) => console.warn('저장 실패', docId, e));
  chains.set(docId, next);
  return next;
}

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
