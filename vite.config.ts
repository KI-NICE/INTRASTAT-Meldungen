/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Fortlaufende Versionsnummer = Anzahl Commits zum Build-Zeitpunkt, sonst "0". */
function versionNumber(): string {
  try {
    return execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return '0'
  }
}

/** Zeitstempel im Format TT/MM/JJJJ_HHMM zum Build-Zeitpunkt. */
function versionTimestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}_${pad(now.getHours())}${pad(now.getMinutes())}`
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative Basis, damit die App unter einer beliebigen GitHub-Pages-
  // Projekt-URL (https://<user>.github.io/<repo>/) funktioniert.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(`Version ${versionNumber()} - ${versionTimestamp()}`),
  },
  test: {
    // Standard: Node-Umgebung (u. a. für ExcelJS/jszip auf Buffer-Basis
    // nötig). Tests, die den Browser-localStorage benötigen, aktivieren
    // jsdom gezielt per `// @vitest-environment jsdom`-Kommentar.
    environment: 'node',
    globals: false,
  },
})
