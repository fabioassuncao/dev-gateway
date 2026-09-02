import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQuery } from './render.tsx'
import { makeContainer, makeOperable, makeStartable } from './fixtures.ts'
import type { Project } from '../../src/shared/types.ts'

const projectAction = vi.fn()

vi.mock('../../src/ui/lib/api.ts', () => ({
  ApiError: class ApiError extends Error {},
  api: { projectAction: (...args: unknown[]) => projectAction(...args) },
}))

const { ProjectActions } = await import('../../src/ui/components/project-actions.tsx')

function project(overrides: Partial<Project> = {}): Project {
  const services = overrides.services ?? [
    makeContainer({ id: 'a-web', name: 'alpha-web-1', service: 'web', project: 'alpha', state: 'exited' }),
  ]
  return {
    name: 'alpha',
    integrated: true,
    workingDir: '/srv/dev/alpha',
    operable: makeOperable('/srv/dev/alpha'),
    startable: makeStartable(true),
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

describe('project actions', () => {
  it('disables Start when the containers are gone', () => {
    renderWithQuery(
      <ProjectActions
        project={project({
          services: [],
          serviceCount: 0,
          runningCount: 0,
          startable: {
            ok: false,
            reason: "this project's containers are gone; start them with the runner (PORTTA_RUNNER=true)",
            via: 'runner',
          },
        })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start' })).toHaveAttribute('title', expect.stringContaining('PORTTA_RUNNER'))
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
  })

  it('disables Start when every service is already running', () => {
    renderWithQuery(
      <ProjectActions
        project={project({
          services: [makeContainer({ state: 'running', service: 'web', project: 'alpha' })],
          runningCount: 1,
          serviceCount: 1,
          startable: makeStartable(false),
        })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
  })
})
