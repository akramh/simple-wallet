import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'extension/assets',
          dest: '.'
        },
        {
          src: 'tokens.json',
          dest: '.'
        },
        {
          src: 'config.json',
          dest: '.'
        },
        {
          src: 'extension/public/licenses.html',
          dest: '.'
        }
      ]
    }),
    // Post-build: move sidepanel.html to root and generate manifest
    {
      name: 'fix-extension-structure',
      closeBundle() {
        const distDir = path.resolve(__dirname, 'dist-extension');

        // Move sidepanel.html to root
        const srcHtml = path.join(distDir, 'extension/sidepanel/sidepanel.html');
        const destHtml = path.join(distDir, 'sidepanel.html');
        if (fs.existsSync(srcHtml)) {
          fs.copyFileSync(srcHtml, destHtml);
          fs.rmSync(path.join(distDir, 'extension'), { recursive: true, force: true });
        }

        // Copy and update manifest
        const srcManifest = path.resolve(__dirname, 'extension/manifest.json');
        const destManifest = path.join(distDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(srcManifest, 'utf-8'));
        manifest.side_panel = { default_path: 'sidepanel.html' };
        fs.writeFileSync(destManifest, JSON.stringify(manifest, null, 2));
      }
    }
  ],
  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, 'extension/sidepanel/sidepanel.html'),
        'background/service-worker': path.resolve(__dirname, 'extension/background/service-worker.ts'),
        'content/injected': path.resolve(__dirname, 'extension/content/injected.ts'),
        'content/provider': path.resolve(__dirname, 'extension/content/provider.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Keep directory structure for background and content scripts
          if (chunkInfo.name.includes('/')) {
            return '[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
