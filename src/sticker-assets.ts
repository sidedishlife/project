// claude.ai(비공개)용 빌드에만 들어가는 스티커 사진. 공개 웹앱 빌드에서는 sticker-assets-empty.ts로 바뀜(vite.config.ts)
export const bundled = import.meta.glob('./stickers/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
