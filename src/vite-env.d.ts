/// <reference types="vite/client" />

declare module '*.xlsx?url' {
  const src: string
  export default src
}

declare module '*.mjs?url' {
  const src: string
  export default src
}
