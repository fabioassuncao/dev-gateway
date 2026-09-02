// Which workspace a running environment belongs to, and why.
//
// Three sources with a stated precedence, each a pure function over data the
// panel already has. The reason is recorded so the UI can say *"adopted because
// it carries portta.project: meu-produto"* rather than presenting a
// mapping with no explanation — which is also how the label and the database
// stop disagreeing: they are one list with a provenance.

import type { Environment } from '../../shared/types.ts'

export type AdoptionSource = 'manual' | 'label' | 'repo-match'

export interface WorkspaceCoordinates {
  id: string
  slug: string
  /** Repository full names this workspace owns, lowercased. */
  repositories: string[]
}

export interface Adoption {
  workspaceId: string
  source: AdoptionSource
}

/** `git@github.com:acme/alpha.git` and `https://github.com/acme/alpha` both → `acme/alpha`. */
export function repositoryCoordinate(repoUrl: string | null): string | null {
  if (!repoUrl) return null
  const cleaned = repoUrl.trim().replace(/\.git$/, '')
  const ssh = /^[^@]+@[^:]+:(.+)$/.exec(cleaned)
  if (ssh?.[1]) return ssh[1].toLowerCase()
  try {
    const parsed = new URL(cleaned)
    return parsed.pathname.replace(/^\//, '').toLowerCase() || null
  } catch {
    return cleaned.includes('/') ? cleaned.toLowerCase() : null
  }
}

/**
 * Resolves one environment.
 *
 * Manual always wins, because the user said so. A `portta.project` label
 * matching a slug is honoured next, because the project declared it (ADR 0001).
 * A repository match is a suggestion, and is applied **only when exactly one
 * workspace owns that coordinate** — an automatic adoption that is wrong is
 * worse than none, so an ambiguous match adopts nothing and lets the user say.
 */
export function resolveAdoption(
  project: Pick<Environment, 'name' | 'group' | 'repo' | 'repoUrl'>,
  workspaces: WorkspaceCoordinates[],
  manual: Map<string, string>,
): Adoption | null {
  const manualId = manual.get(project.name)
  if (manualId !== undefined) return { workspaceId: manualId, source: 'manual' }

  if (project.group) {
    const declared = workspaces.find((workspace) => workspace.slug === project.group)
    if (declared) return { workspaceId: declared.id, source: 'label' }
  }

  const coordinate = repositoryCoordinate(project.repoUrl) ?? project.repo?.toLowerCase() ?? null
  if (coordinate === null) return null

  const owners = workspaces.filter((workspace) => workspace.repositories.includes(coordinate))
  if (owners.length !== 1) return null
  return { workspaceId: owners[0]!.id, source: 'repo-match' }
}

export function resolveAdoptions(
  projects: ReadonlyArray<Pick<Environment, 'name' | 'group' | 'repo' | 'repoUrl'>>,
  workspaces: WorkspaceCoordinates[],
  manual: Map<string, string>,
): Map<string, Adoption> {
  const resolved = new Map<string, Adoption>()
  for (const project of projects) {
    const adoption = resolveAdoption(project, workspaces, manual)
    if (adoption) resolved.set(project.name, adoption)
  }
  return resolved
}
