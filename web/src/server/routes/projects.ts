import { Hono } from 'hono'
import type { AppDeps } from './deps.ts'
import { HTTPException } from 'hono/http-exception'

export function projectRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  // Projects are the integrated ones: a Compose project with at least one
  // service on the gateway. Everything else lives on the Docker page, where it
  // is clearly labelled as being outside the gateway.
  app.get('/projects', async (c) => {
    const snapshot = await deps.cache.get()
    const all = c.req.query('all') === 'true'
    const projects = all ? snapshot.projects : snapshot.projects.filter((project) => project.integrated)
    return c.json({ projects })
  })

  app.get('/projects/:project', async (c) => {
    const snapshot = await deps.cache.get()
    const name = c.req.param('project')
    const project = snapshot.projects.find((item) => item.name === name)
    if (!project) throw new HTTPException(404, { message: `no project '${name}' is running` })
    return c.json(project)
  })

  return app
}
