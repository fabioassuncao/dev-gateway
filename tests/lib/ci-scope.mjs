export function ciScope(files, release = false) {
  const code = release || files.some((file) => !/^(docs\/|README\.md$|CHANGELOG\.md$|AGENTS\.md$|CLAUDE\.md$)/.test(file))
  const browser = new Set(), gateway = new Set()
  const allGateway = ['adoption', 'apply', 'lifecycle', 'local-tls', 'parallel', 'tcp-access', 'tcp-routing', 'web-panel']
  const allBrowser = ['panel', 'infrastructure', 'development', 'auth', 'roles', 'settings']
  for (const file of files) {
    if (/^(package(?:-lock)?\.json|apps\/web\/lib\/.*auth|packages\/.*\/package\.json)/.test(file)) {
      for (const s of allBrowser) browser.add(s)
      for (const s of allGateway) gateway.add(s)
    }
    const spec = /^apps\/web\/e2e\/(\w+)\.spec\.ts$/.exec(file)
    const suite = /^tests\/e2e\/([\w-]+)\.test\.sh$/.exec(file)
    if (spec) browser.add(spec[1])
    if (suite) gateway.add(suite[1])
    if (/^(packages\/auth\/|apps\/auth\/|packages\/server\/src\/(api\/.*(?:auth|users|security)|realtime\/))/.test(file)) for (const s of ['auth', 'roles', 'settings']) browser.add(s)
    if (/^apps\/web\/(server\/|playwright\.|e2e\/.*\.(?:mjs|ts)$)/.test(file) && !spec) for (const s of allBrowser) browser.add(s)
    if (/^apps\/web\/app\/.*(?:layout|page)\.tsx$/.test(file)) browser.add('panel')
    if (/^(docker\/|templates\/|bin\/|install\.sh$|scripts\/|tests\/docker\/|tests\/gateway-e2e|tests\/lib\/require-disposable|\.github\/|tests\/run\.|\.env\.example$)/.test(file)) for (const s of allGateway) gateway.add(s)
    if (/^packages\/cli\/src\/commands\/(?:lifecycle|setup|maintenance|web|network|access|remote)/.test(file)) for (const s of allGateway) gateway.add(s)
    if (/^(packages\/db\/|packages\/core\/src\/(?:config|profiles|apply|runner|database))/.test(file)) { gateway.add('web-panel'); gateway.add('lifecycle') }
  }
  if (release) { for (const s of allGateway) gateway.add(s); for (const s of allBrowser) browser.add(s) }
  return { code, browser: [...browser].sort(), gateway: [...gateway].sort() }
}
