import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'extension/manifest.json',
          dest: '.'
        },
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
        }
      ]
    })
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
