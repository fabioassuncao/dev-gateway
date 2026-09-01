import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from './deps.ts'
import { HTTPException } from 'hono/http-exception'
import { readProjectGit } from '../core/git.ts'
import { Project, ProjectGit } from '../../shared/types.ts'
import { documentRoute, projectParameter } from '../openapi.ts'

export const ProjectsResponse = z.object({ projects: z.array(Project) }).strict().meta({ ref: 'ProjectsResponse' })

export function projectRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Projects are the integrated ones: a Compose project with at least one
  // service on the gateway. Everything else lives on the Docker page, where it
  // is clearly labelled as being outside the gateway.
  app.get('/projects', documentRoute({
    tag: 'Projects', operationId: 'listProjects', summary: 'List Compose projects', response: ProjectsResponse,
    parameters: [{
      name: 'all', in: 'query', required: false,
      description: 'Include Compose projects that have not adopted the gateway.',
      schema: { type: 'boolean', default: false },
    }],
    errors: [500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const all = c.req.query('all') === 'true'
    const projects = all ? snapshot.projects : snapshot.projects.filter((project) => project.integrated)
    return c.json({ projects })
  })

  app.get('/projects/:project', documentRoute({
    tag: 'Projects', operationId: 'getProject', summary: 'Get one running project', response: Project,
    parameters: [projectParameter], errors: [404, 500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const name = c.req.param('project')
    const project = snapshot.projects.find((item) => item.name === name)
    if (!project) throw new HTTPException(404, { message: `no project '${name}' is running` })
    return c.json(project)
  })

  /**
   * What the host collected about this project's repository. Never live: the
   * panel reads a file and reports its age, and the response carries the
   * command that refreshes it. A project with no Git, no remote or no scan
   * gets a 200 with fewer fields, never an error.
   */
  app.get('/projects/:project/git', documentRoute({
    tag: 'Projects', operationId: 'getProjectGit', summary: 'Get collected Git metadata', response: ProjectGit,
    description: 'Reads a host-collected snapshot. No scan, repository or remote is represented as a smaller 200 response.',
    parameters: [projectParameter], errors: [404, 500],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const name = c.req.param('project')
    if (!snapshot.projects.some((item) => item.name === name)) {
      throw new HTTPException(404, { message: `no project '${name}' is running` })
    }
    return c.json(readProjectGit(deps.config, name))
  })

  return app
}
