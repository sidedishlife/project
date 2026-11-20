import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE=1 이면 JS/CSS를 HTML 한 파일에 넣음 (claude.ai 아티팩트, 파일로 바로 열기용)
export default defineConfig({
  base: './',
  plugins: process.env.SINGLE ? [viteSingleFile()] : [],
  build: process.env.SINGLE ? { outDir: 'dist-single', copyPublicDir: false } : {},
});
