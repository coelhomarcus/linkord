import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Twemoji's SVGs, the same emoji pictures on every system (Discord's own
// package). Served from /assets/twemoji/<version>/, so the server caches them
// for good like Vite's hashed files, and a new version gets new URLs.
const TWEMOJI_DIR = path.resolve(import.meta.dirname, 'node_modules/@discordapp/twemoji/dist/svg');
const TWEMOJI_VERSION: string = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'node_modules/@discordapp/twemoji/package.json'), 'utf8')).version;
const TWEMOJI_PATH = `/assets/twemoji/${TWEMOJI_VERSION}/`;

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
  plugins: [react(), tailwindcss(), twemojiAssets()],
  define: {
    __TWEMOJI_PATH__: JSON.stringify(TWEMOJI_PATH),
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
