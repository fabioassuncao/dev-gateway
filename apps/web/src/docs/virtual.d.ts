// The documentation bundle the Vite plugin builds. Declared here so the app can
// import it with a type: the module does not exist on disk, and pretending it
// does with a checked-in JSON file would be a second copy of the docs.
declare module 'virtual:portta-docs' {
  import type { DocsBundle } from './collect.ts'
  const bundle: DocsBundle
  export default bundle
}
