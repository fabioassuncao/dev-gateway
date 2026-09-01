import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApi } from './app.ts'
import { loadConfig } from './config.ts'
import type { AppDeps } from './routes/deps.ts'
import { generateOpenApi } from './openapi.ts'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '../..')
const repositoryRoot = resolve(webRoot, '..')
const output = resolve(webRoot, 'openapi.json')
const version = readFileSync(resolve(repositoryRoot, 'VERSION'), 'utf8').trim()

// Route registration captures the dependencies but does not call them. The
// generator therefore needs only the real resolved config; no Docker call,
// working tree or network is involved in producing the contract.
const deps = { config: loadConfig({ gatewayVersion: version }) } as AppDeps
const rendered = `${JSON.stringify(await generateOpenApi(createApi(deps), version), null, 2)}\n`

if (process.argv.includes('--check')) {
  const checkedIn = readFileSync(output, 'utf8')
  if (checkedIn !== rendered) {
    process.stderr.write('web/openapi.json is stale; run: npm run openapi\n')
    process.exitCode = 1
  }
} else {
  writeFileSync(output, rendered, 'utf8')
  process.stdout.write(`wrote ${output}\n`)
}
