// The browser's copy of portta-core's `slug`.
//
// The server imports the shared one. This exists because the UI bundle must not
// import portta-core: its index re-exports the password module, and the UI dev
// container carries neither the shared package's source nor its build, so
// `npm run dev:ui` would stop resolving it.
//
// apps/web/tests/server/slug.test.ts asserts the two answer identically over a
// corpus, which is what a comment asking for that used to do. A hostname the
// panel prints has to be the one Traefik serves.

export function slug(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '')
}
