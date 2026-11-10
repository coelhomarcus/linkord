import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { reactEasyCropStyleSource } from './scripts/cspStyleSources.ts';

// Twemoji's SVGs, the same emoji pictures on every system (Discord's own
// package). Served from /assets/twemoji/<version>/, so the server caches them
// for good like Vite's hashed files, and a new version gets new URLs.
const TWEMOJI_DIR = path.resolve(import.meta.dirname, 'node_modules/@discordapp/twemoji/dist/svg');
const TWEMOJI_VERSION: string = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'node_modules/@discordapp/twemoji/package.json'), 'utf8')).version;
const TWEMOJI_PATH = `/assets/twemoji/${TWEMOJI_VERSION}/`;
// public/emoji-data is rebuilt from both packages (npm run emoji:data); its URL
// changes with them, so a deploy never leaves a browser on the cached old list
const EMOJIBASE_VERSION: string = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'node_modules/emojibase-data/package.json'), 'utf8')).version;

// The crop dialog injects its CSS at runtime, so the server cannot hash it
// from the HTML. The string lands in dist next to index.html and is read at boot.
const CSP_STYLE_SOURCES = 'csp-style-sources.json';
const CROP_MODULE = path.resolve(import.meta.dirname, 'node_modules/react-easy-crop/index.module.mjs');

function cspStyleSources(): Plugin {
  let outDir = '';
  return {
    name: 'csp-style-sources',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    writeBundle() {
      const css = reactEasyCropStyleSource(fs.readFileSync(CROP_MODULE, 'utf8'));
      if (!css) throw new Error('react-easy-crop stylesheet not found; style-src-elem would block the crop dialog');
      fs.writeFileSync(path.join(outDir, CSP_STYLE_SOURCES), JSON.stringify({ sources: [css] }));
    },
  };
}

function twemojiAssets(): Plugin {
  let outDir = '';
  return {
    name: 'twemoji-assets',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    configureServer(server) {
      server.middlewares.use(TWEMOJI_PATH, (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\//, ''));
        if (!/^[0-9a-f-]+\.svg$/.test(name)) return next();
        const file = path.join(TWEMOJI_DIR, name);
        if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', 'image/svg+xml');
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      fs.cpSync(TWEMOJI_DIR, path.join(outDir, TWEMOJI_PATH), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), twemojiAssets(), cspStyleSources()],
  define: {
    __TWEMOJI_PATH__: JSON.stringify(TWEMOJI_PATH),
    __EMOJI_DATA_VERSION__: JSON.stringify(`${EMOJIBASE_VERSION}-${TWEMOJI_VERSION}`),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@tests': path.resolve(import.meta.dirname, './tests'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'http://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000' },
      '/uploads': { target: 'http://localhost:3000' },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
