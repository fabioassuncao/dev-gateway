// The repositories of a Project: decisions, in their own module.
//
// A row here is what the operator registered: a name, where the code lives on
// the host, its remote, its role, and optionally the GitHub projection row it
// corresponds to. What the host scan observed about it (branch, commits,
// instruction files) is read from state/git at request time and never stored;
// `core/repositories.ts` joins the two.

import { z } from 'zod'
import { posix } from 'node:path'
import type { Sql } from 'postgres'
import type { DatabaseClient } from './client.ts'

/** Documented vocabulary, not an enum: adding one later is not a migration. */
export const REPOSITORY_ROLES = ['api', 'web', 'mobile', 'services', 'infra', 'docs', 'other'] as const

export const REPOSITORY_PROVIDERS = ['local', 'github', 'gitlab', 'bitbucket', 'other'] as const
export type RepositoryProvider = (typeof REPOSITORY_PROVIDERS)[number]

export interface RepositoryRecord {
  id: string
  projectId: string
  name: string
  role: string | null
  localPath: string | null
  relativePath: string | null
  remoteUrl: string | null
  provider: RepositoryProvider
  githubRepositoryId: string | null
  position: number
  createdAt: Date
  updatedAt: Date
}

/** A record plus the GitHub projection row it points at, when it points at one. */
export interface RepositoryRow extends RepositoryRecord {
  github: {
    repositoryId: string
    fullName: string
    htmlUrl: string
    defaultBranch: string | null
    private: boolean
    archived: boolean
  } | null
}

/** Which forge a remote belongs to, from its host. `local` when there is no remote. */
export function providerFor(remoteUrl: string | null | undefined, githubLinked = false): RepositoryProvider {
  if (githubLinked) return 'github'
  if (!remoteUrl) return 'local'
  const value = remoteUrl.toLowerCase()
  if (/github\.com[/:]/.test(value)) return 'github'
  if (/gitlab\.com[/:]/.test(value) || /gitlab\./.test(value)) return 'gitlab'
  if (/bitbucket\.org[/:]/.test(value)) return 'bitbucket'
  return 'other'
}

const Name = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/, 'a repository name is letters, digits, dots, dashes and spaces')

/** Absolute, canonical, and never walking up. The panel cannot stat it; the host scan can. */
const LocalPath = z.string().max(1024).transform((value, ctx) => {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.includes('\0') || posix.normalize(trimmed).split('/').includes('..')) {
    ctx.addIssue({ code: 'custom', message: 'localPath must be an absolute path on the host that does not walk up' })
    return z.NEVER
  }
  const normalized = posix.normalize(trimmed).replace(/\/+$/, '')
  return normalized === '' ? '/' : normalized
})

/** Inside the Project: `api`, `packages/web`. Never absolute, never `..`. */
const RelativePath = z.string().max(255).transform((value, ctx) => {
  const trimmed = value.trim()
  const normalized = posix.normalize(trimmed).replace(/^\.\//, '').replace(/\/+$/, '')
  if (trimmed === '' || trimmed.startsWith('/') || trimmed.includes('\0') || normalized === '.' || normalized.split('/').some((part) => part === '..' || part === '')) {
    ctx.addIssue({ code: 'custom', message: 'relativePath must stay inside the Project: no leading slash, no ..' })
    return z.NEVER
  }
  return normalized
})

const Role = z.string().max(32).regex(/^[a-z][a-z0-9-]*$/, 'a role is a lowercase word').nullable()
const RemoteUrl = z.string().min(1).max(512).nullable()
const GitHubId = z.string().regex(/^\d+$/).nullable()

export const CreateRepository = z.object({
  name: Name,
  role: Role.default(null),
  localPath: LocalPath.nullable().default(null),
  relativePath: RelativePath.nullable().default(null),
  remoteUrl: RemoteUrl.default(null),
  provider: z.enum(REPOSITORY_PROVIDERS).optional(),
  githubRepositoryId: GitHubId.default(null),
  position: z.number().int().min(0).max(10_000).default(0),
}).strict()
export type CreateRepositoryInput = z.infer<typeof CreateRepository>

export const UpdateRepository = z.object({
  name: Name.optional(),
  role: Role.optional(),
  localPath: LocalPath.nullable().optional(),
  relativePath: RelativePath.nullable().optional(),
  remoteUrl: RemoteUrl.optional(),
  provider: z.enum(REPOSITORY_PROVIDERS).optional(),
  githubRepositoryId: GitHubId.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
}).strict()
export type UpdateRepositoryInput = z.infer<typeof UpdateRepository>

const COLUMNS = `
  r.id::text AS id,
  r.project_id::text AS "projectId",
  r.name, r.role,
  r.local_path AS "localPath",
  r.relative_path AS "relativePath",
  r.remote_url AS "remoteUrl",
  r.provider,
  r.github_repository_id::text AS "githubRepositoryId",
  r.position, r.created_at AS "createdAt", r.updated_at AS "updatedAt",
  gr.id::text AS "ghId", gr.full_name AS "ghFullName", gr.html_url AS "ghHtmlUrl",
  gr.default_branch AS "ghDefaultBranch", gr.private AS "ghPrivate", gr.archived AS "ghArchived"
`

interface JoinedRow extends RepositoryRecord {
  ghId: string | null
  ghFullName: string | null
  ghHtmlUrl: string | null
  ghDefaultBranch: string | null
  ghPrivate: boolean | null
  ghArchived: boolean | null
}

function toRow(joined: JoinedRow): RepositoryRow {
  const { ghId, ghFullName, ghHtmlUrl, ghDefaultBranch, ghPrivate, ghArchived, ...record } = joined
  return {
    ...record,
    github: ghId && ghFullName && ghHtmlUrl
      ? {
          repositoryId: ghId,
          fullName: ghFullName,
          htmlUrl: ghHtmlUrl,
          defaultBranch: ghDefaultBranch,
          private: ghPrivate === true,
          archived: ghArchived === true,
        }
      : null,
  }
}

export class RepositoriesRepository {
  private readonly sql: Sql

  constructor(client: DatabaseClient) {
    this.sql = client.handle
  }

  async list(projectId?: string): Promise<RepositoryRow[]> {
    const rows = projectId === undefined
      ? await this.sql<JoinedRow[]>`
          SELECT ${this.sql.unsafe(COLUMNS)} FROM repositories r
          LEFT JOIN github_repositories gr ON gr.id = r.github_repository_id
          ORDER BY r.project_id, r.position, r.name`
      : await this.sql<JoinedRow[]>`
          SELECT ${this.sql.unsafe(COLUMNS)} FROM repositories r
          LEFT JOIN github_repositories gr ON gr.id = r.github_repository_id
          WHERE r.project_id = ${projectId}
          ORDER BY r.position, r.name`
    return rows.map(toRow)
  }

  async find(id: string): Promise<RepositoryRow | null> {
    if (!/^\d+$/.test(id)) return null
    const rows = await this.sql<JoinedRow[]>`
      SELECT ${this.sql.unsafe(COLUMNS)} FROM repositories r
      LEFT JOIN github_repositories gr ON gr.id = r.github_repository_id
      WHERE r.id = ${id}`
    return rows[0] ? toRow(rows[0]) : null
  }

  async findByGitHub(githubRepositoryId: string): Promise<RepositoryRow | null> {
    const rows = await this.sql<JoinedRow[]>`
      SELECT ${this.sql.unsafe(COLUMNS)} FROM repositories r
      LEFT JOIN github_repositories gr ON gr.id = r.github_repository_id
      WHERE r.github_repository_id = ${githubRepositoryId}`
    return rows[0] ? toRow(rows[0]) : null
  }

  async create(projectId: string, input: unknown): Promise<RepositoryRow> {
    const parsed = CreateRepository.parse(input)
    const provider = parsed.provider ?? providerFor(parsed.remoteUrl, parsed.githubRepositoryId !== null)
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO repositories (project_id, name, role, local_path, relative_path, remote_url, provider, github_repository_id, position)
      VALUES (${projectId}, ${parsed.name}, ${parsed.role}, ${parsed.localPath}, ${parsed.relativePath},
              ${parsed.remoteUrl}, ${provider}, ${parsed.githubRepositoryId}, ${parsed.position})
      RETURNING id::text AS id`
    const created = rows[0] ? await this.find(rows[0].id) : null
    if (!created) throw new Error('database did not return the repository it created')
    return created
  }

  /** Three-valued on the nullable columns: absent leaves it, null clears it, a value sets it. */
  async update(id: string, patch: unknown): Promise<RepositoryRow | null> {
    const parsed = UpdateRepository.parse(patch)
    const current = await this.find(id)
    if (!current) return null
    const has = (key: keyof UpdateRepositoryInput) => Object.hasOwn(parsed, key)
    const next = {
      name: parsed.name ?? current.name,
      role: has('role') ? parsed.role ?? null : current.role,
      localPath: has('localPath') ? parsed.localPath ?? null : current.localPath,
      relativePath: has('relativePath') ? parsed.relativePath ?? null : current.relativePath,
      remoteUrl: has('remoteUrl') ? parsed.remoteUrl ?? null : current.remoteUrl,
      githubRepositoryId: has('githubRepositoryId') ? parsed.githubRepositoryId ?? null : current.githubRepositoryId,
      position: parsed.position ?? current.position,
    }
    const provider = parsed.provider
      ?? (has('remoteUrl') || has('githubRepositoryId') ? providerFor(next.remoteUrl, next.githubRepositoryId !== null) : current.provider)
    await this.sql`
      UPDATE repositories SET
        name = ${next.name}, role = ${next.role}, local_path = ${next.localPath},
        relative_path = ${next.relativePath}, remote_url = ${next.remoteUrl}, provider = ${provider},
        github_repository_id = ${next.githubRepositoryId}, position = ${next.position}, updated_at = now()
      WHERE id = ${id}`
    return this.find(id)
  }

  /** Removes the registration. The clone, the remote and the GitHub row are untouched. */
  async remove(id: string): Promise<boolean> {
    if (!/^\d+$/.test(id)) return false
    const rows = await this.sql<{ id: string }[]>`DELETE FROM repositories WHERE id = ${id} RETURNING id::text AS id`
    return rows.length > 0
  }
}
