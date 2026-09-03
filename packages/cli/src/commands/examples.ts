// Apply the declarative example documents under docker/examples/.
//
// The panel is the only writer. This command reads portta.example.json files,
// ensures the Project exists, and posts the document to /tasks/import.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { EXAMPLE_MANIFEST_NAME, ExampleDocument } from 'portta-core'
import { segment } from '../api.js'
import { gatewayContext } from '../context.js'
import { UsageError } from '../errors.js'
import { clientFor, workGlobals } from './work.js'

export function findExampleManifests(root: string): string[] {
  const dir = join(root, 'docker', 'examples')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name, EXAMPLE_MANIFEST_NAME))
    .filter((path) => existsSync(path))
}

export async function examplesApply(options: { file?: string }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  const context = gatewayContext({ profile: workGlobals(command).profile, required: false })
  const files = options.file ? [options.file] : findExampleManifests(context.root)
  if (files.length === 0) throw new UsageError(`no ${EXAMPLE_MANIFEST_NAME} under docker/examples; pass --file`)

  for (const path of files) {
    const document = ExampleDocument.parse(JSON.parse(readFileSync(path, 'utf8')))
    const slug = document.project.slug
    const existing = await client.answer('GET', `/projects/${segment(slug)}`)
    if (existing.status === 404) {
      await client.request('POST', '/projects', {
        slug,
        name: document.project.name,
        description: document.project.description ?? null,
      })
      output.progress(`created project ${slug}`)
    } else if (!existing.ok) {
      await client.request('GET', `/projects/${segment(slug)}`)
    }
    const applied = await client.request<{ created: number; updated: number }>('POST', `/projects/${segment(slug)}/tasks/import`, document)
    output.progress(`${slug}: ${applied.created} created, ${applied.updated} updated (${path})`)
    if (output.json) output.data({ path, ...applied })
  }
}

export async function tasksImport(options: { project?: string; file?: string }, command: Command): Promise<void> {
  const { client, output } = clientFor(command)
  if (!options.file) throw new UsageError('--file is required')
  if (!options.project) throw new UsageError('--project is required')
  const document = ExampleDocument.parse(JSON.parse(readFileSync(options.file, 'utf8')))
  const applied = await client.request<{ created: number; updated: number }>('POST', `/projects/${segment(options.project)}/tasks/import`, document)
  if (output.json) return output.data(applied)
  output.progress(`${options.project}: ${applied.created} created, ${applied.updated} updated`)
}
