import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'path'

function offlineAppShellPlugin(): Plugin {
  const template = readFileSync(path.resolve(__dirname, 'scripts/service-worker-template.js'), 'utf8')

  return {
    name: 'kodigo-offline-app-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const emittedAssets = Object.values(bundle)
        .filter((file) => file.fileName.startsWith('assets/'))
        .filter((file) => !file.fileName.endsWith('.map'))
        .map((file) => `/${file.fileName}`)
        .sort()
      const precacheUrls = Array.from(new Set([
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/kodigo-icon.png',
        ...emittedAssets,
      ]))
      const shellVersion = createHash('sha256')
        .update(`${process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'local'}\n${precacheUrls.join('\n')}`)
        .digest('hex')
        .slice(0, 16)
      const serviceWorker = template
        .replace('__KODIGO_SHELL_VERSION__', shellVersion)
        .replace('__KODIGO_PRECACHE_URLS__', JSON.stringify(precacheUrls))
        .replace('__KODIGO_DATABASE_VERSION__', '3')
        .replace('__KODIGO_OPERATION_CONTRACTS__', '[1]')

      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source: serviceWorker })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), offlineAppShellPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
