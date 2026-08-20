/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative Basis, damit die App unter einer beliebigen GitHub-Pages-
  // Projekt-URL (https://<user>.github.io/<repo>/) funktioniert.
  base: './',
  test: {
    // Standard: Node-Umgebung (u. a. für ExcelJS/jszip auf Buffer-Basis
    // nötig). Tests, die den Browser-localStorage benötigen, aktivieren
    // jsdom gezielt per `// @vitest-environment jsdom`-Kommentar.
    environment: 'node',
    globals: false,
  },
})
