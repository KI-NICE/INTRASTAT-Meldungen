/// <reference types="vite/client" />

/** Zur Build-Zeit über `vite.config.ts` (`define`) eingesetzte Versionsangabe ("Version Nr - TT/MM/JJJJ_HHMM"). */
declare const __APP_VERSION__: string

declare module '*.xlsx?url' {
  const src: string
  export default src
}

declare module '*.mjs?url' {
  const src: string
  export default src
}
