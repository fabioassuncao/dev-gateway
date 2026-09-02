import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { makeContainer, makeOperable, makeStartable } from './fixtures.ts'
import type { Project, ProjectRemovalPreview } from '../../src/shared/types.ts'

const rebuildProject = vi.fn()
const removeProject = vi.fn()
const projectRemovalPreview = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    rebuildProject: (...args: unknown[]) => rebuildProject(...args),
    removeProject: (...args: unknown[]) => removeProject(...args),
    projectRemovalPreview: (...args: unknown[]) => projectRemovalPreview(...args),
    runnerProbe: async () => ({ state: 'idle', available: true, logTail: [] }),
  },
}))

const { ProjectOperations } = await import('../../src/ui/components/project-operations.tsx')

function project(overrides: Partial<Project> = {}): Project {
  const services = overrides.services ?? [
    makeContainer({ id: 'a-web', name: 'alpha-web-1', service: 'web', project: 'alpha', state: 'running' }),
  ]
  return {
    name: 'alpha',
    integrated: true,
    workingDir: '/srv/dev/alpha',
    operable: makeOperable('/srv/dev/alpha'),
    startable: makeStartable(false),
    namespace: null,
    group: null,
    repo: null,
    repoUrl: null,
    gitRoot: null,
    serviceCount: services.length,
    runningCount: services.filter((service) => service.state === 'running').length,
    healthyCount: 0,
    unhealthyCount: 0,
    services,
    networks: [],
    urls: [],
    scopes: [],
    startedAt: null,
    uptimeSeconds: null,
    ...overrides,
  }
}

const preview: ProjectRemovalPreview = {
  project: 'alpha',
  containers: [{ id: 'a-web', name: 'alpha-web-1', service: 'web', state: 'running', image: 'nginx' }],
  networks: ['alpha_default'],
  volumes: [{ name: 'alpha_pgdata', sizeBytes: null }],
  workingDir: '/srv/dev/alpha',
  git: { collected: false, dirty: false, staged: 0, unstaged: 0, untracked: 0 },
  records: {
    overrides: 0, aliases: 0, workspaceLinks: 0, issueLinks: 0,
    accessBridges: [], accessForwarders: [], accessFiles: [],
  },
  runnerAvailable: false,
  directoryRemovalAvailable: false,
}

describe('project operations', () => {
  it('disables Rebuild when the project is not operable', () => {
    renderWithQuery(
      <ProjectOperations
        project={project({ operable: makeOperable(null) })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeDisabled()
  })

  it('keeps Remove disabled until the project name is typed', async () => {
    const user = userEvent.setup()
    projectRemovalPreview.mockResolvedValue(preview)
    renderWithQuery(<ProjectOperations project={project()} />)
    await user.click(screen.getByRole('button', { name: 'Remove, keep data' }))
    expect(await screen.findByText(/GitHub repository/)).toBeInTheDocument()
    const submit = screen.getAllByRole('button', { name: 'Remove, keep data' }).at(-1)!
    expect(submit).toBeDisabled()
    await user.type(screen.getByRole('textbox'), 'alpha')
    expect(submit).toBeEnabled()
  })
})
