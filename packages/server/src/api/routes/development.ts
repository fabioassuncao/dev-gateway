// The development surfaces: the consolidated Service of an environment, the
// Development Context an agent reads before it works, a Project's attributed
// resources, and the Development Dashboard.
//
// Nothing here is a new source of truth. Each route reads what the others
// already read — the snapshot, the catalog, the tasks, the scans, the metrics
// — and hands it to a pure presenter in core/, where the shape is tested.

import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { nextTask, type SchedulableTask } from 'portta-core'
import type { AppDeps } from './deps.ts'
import { documentRoute, projectParameter } from '../openapi.ts'
import { principalOf } from '../principal.ts'
import { requireDatabase, type Database } from '../../db/index.ts'
import type { TaskRow } from '../../db/tasks.ts'
import { applyOverrides, loadOverrides } from '../../services/overrides.ts'
import { listBridges } from '../../services/access.ts'
import { runContainerAction } from '../../services/actions.ts'
import { readCurrentMetrics } from '../../services/metrics.ts'
import { readRepositoryScan } from '../../services/git.ts'
import { loadProjectCatalog, toProject } from '../../services/catalog.ts'
import { loadTaskContext, taskSummaries, taskView } from '../../services/task-view.ts'
import { loadNames, sessionView } from '../../services/activity-view.ts'
import { environmentServices } from '../../services/service-view.ts'
import { findRememberedEnvironment } from '../../services/remembered.ts'
import { buildContext } from '../../services/context-view.ts'
import { buildOverview } from '../../services/overview-view.ts'
import { diagnose, problemsOnly } from '../../services/diagnostics.ts'
import { gatewayStatus } from '../../services/gateway.ts'
import { listShares } from '../../services/shares.ts'
import { loadAliases } from '../../services/overrides.ts'
import { githubStatusOf } from './integrations.ts'
import { recordActivity } from '../../services/activity.ts'
import {
  ActionResult,
  DevelopmentContext,
  DevelopmentOverview,
  EnvironmentServices,
  ProjectResources,
} from 'portta-contracts'
import type { Environment, Project, RepositoryGit, TaskSummary } from 'portta-contracts'

const slugParameter = { name: 'slug', in: 'path' as const, required: true, description: 'The Project slug.', schema: { type: 'string' as const } }
const serviceParameter = { name: 'service', in: 'path' as const, required: true, description: 'Compose service name.', schema: { type: 'string' as const } }
const ServiceAction = z.enum(['start', 'stop', 'restart'])

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

export function developmentRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function environmentNamed(name: string): Promise<Environment> {
    const snapshot = await deps.cache.get()
    // A remembered environment (containers gone, row kept) answers too, with
    // no services: the page renders it with its start-or-forget choice.
    const found = snapshot.environments.find((item) => item.name === name) ?? await findRememberedEnvironment(deps.db, snapshot, deps.config, name)
    if (!found) throw new HTTPException(404, { message: `no environment '${name}' is running` })
    return applyOverrides([found], await loadOverrides(deps.db))[0]!
  }

  async function projects(db: Database): Promise<Project[]> {
    const snapshot = await deps.cache.get()
    const catalog = await loadProjectCatalog(db, snapshot, deps.config)
    return catalog.records.map((record) => toProject(record, catalog.repositoriesByProject.get(record.id) ?? [], catalog.environments.get(record.id) ?? [], catalog.projectsHome))
  }

  async function projectNamed(db: Database, slug: string): Promise<Project> {
    const project = (await projects(db)).find((item) => item.slug === slug)
    if (!project) throw new HTTPException(404, { message: `no project '${slug}'` })
    return project
  }

  function scansFor(list: readonly Project[]): Map<string, RepositoryGit> {
    const scans = new Map<string, RepositoryGit>()
    for (const project of list) {
      for (const repository of project.repositories) {
        if (repository.scanKey && !scans.has(repository.scanKey)) scans.set(repository.scanKey, readRepositoryScan(deps.config, repository.scanKey))
      }
    }
    return scans
  }

  function schedulable(rows: readonly TaskRow[]): SchedulableTask[] {
    return rows.map((row) => ({ id: row.id, parentId: row.parentId, status: row.status, priority: row.priority, assignee: row.assignee, waitingSince: seconds(row.updatedAt) }))
  }

  // --- the consolidated Service ---------------------------------------------

  app.get('/environments/:project/services', documentRoute({
    tag: 'Environments', operationId: 'listEnvironmentServices', capability: 'service:read',
    summary: 'The services of one environment, consolidated',
    description: 'Each service with its state, health, access (endpoints, bridge, primary address), resources from the host collector, runtime and the actions that apply. What used to be three views is one row.',
    response: EnvironmentServices, parameters: [projectParameter], errors: [404, 500, 502],
  }), async (c) => {
    const environment = await environmentNamed(c.req.param('project'))
    const snapshot = await deps.cache.get()
    const readOnly = principalOf(c).readOnly
    return c.json(environmentServices(environment, deps.config, readCurrentMetrics(deps.config), listBridges(snapshot), { readOnly }))
  })

  app.post('/environments/:project/services/:service/actions/:action', documentRoute({
    tag: 'Environments', operationId: 'runServiceAction', capability: 'environment:operate',
    summary: 'Start, stop or restart one service of an environment',
    description: 'Resolves the service to its container and runs the same guarded action the Docker endpoints run. Gateway components are refused.',
    response: ActionResult, parameters: [projectParameter, serviceParameter, { name: 'action', in: 'path', required: true, schema: { type: 'string', enum: [...ServiceAction.options] } }],
    errors: [400, 403, 404, 409, 500, 502],
  }), async (c) => {
    const action = ServiceAction.safeParse(c.req.param('action'))
    if (!action.success) throw new HTTPException(400, { message: `'${c.req.param('action')}' is not start, stop or restart` })
    const environment = await environmentNamed(c.req.param('project'))
    const name = c.req.param('service')
    const target = environment.services.find((service) => (service.service ?? service.name) === name)
    if (!target) throw new HTTPException(404, { message: `no service '${name}' in '${environment.name}'` })
    const snapshot = await deps.cache.get()
    const container = await runContainerAction(deps.client, snapshot, target.id, action.data)
    deps.cache.invalidate()
    const principal = principalOf(c)
    const db = deps.db
    if (db) {
      const environmentRow = await db.environments.find(environment.name).catch(() => null)
      await recordActivity(deps, {
        kind: action.data === 'start' ? 'environment.started' : action.data === 'stop' ? 'environment.stopped' : 'environment.restarted',
        summary: `${name} of ${environment.name}: ${action.data}`,
        actor: principal.actor, actorKind: principal.actorKind,
        environmentId: environmentRow?.id ?? null,
        data: { service: name, container: container.name },
      })
    }
    return c.json({ ok: true, action: action.data, containerId: container.id, message: `${action.data} sent to ${container.name}` })
  })

  // --- the Development Context ------------------------------------------------

  app.get('/projects/:slug/context', documentRoute({
    tag: 'Projects', operationId: 'getProjectContext', capability: 'project:read',
    summary: 'The Development Context of a project, for an agent about to work',
    description: 'The project, its repositories with their git state and instruction files, the environments with their services and commands, the work in progress and the next task, the effective instructions, and the CLI verbs that matter. Name a task with ?task= to include it.',
    response: DevelopmentContext, parameters: [slugParameter, { name: 'task', in: 'query', required: false, description: 'A task id to include in full.', schema: { type: 'string' } }],
    errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await projectNamed(db, c.req.param('slug'))
    const snapshot = await deps.cache.get()
    const overrides = await loadOverrides(deps.db)
    const adopted = new Set(project.environments.map((link) => link.environment))
    const environments = applyOverrides(snapshot.environments.filter((environment) => adopted.has(environment.name)), overrides)
    const metrics = readCurrentMetrics(deps.config)
    const bridges = listBridges(snapshot)
    const principal = principalOf(c)
    const services = new Map(environments.map((environment) => [environment.name, environmentServices(environment, deps.config, metrics, bridges, { readOnly: principal.readOnly })]))

    const rows = await db.tasks.list({ projectId: project.id, open: true })
    const ctx = await loadTaskContext(deps.config, db, snapshot)
    const summaries = taskSummaries(ctx, rows)
    const chosen = nextTask(schedulable(rows), { actor: principal.actor })
    const taskId = c.req.query('task')
    let task = null
    if (taskId) {
      const row = await db.tasks.find(taskId.replace(/^#/, ''))
      if (!row || row.projectId !== project.id) throw new HTTPException(404, { message: `no task '${taskId}' in '${project.slug}'` })
      const [notes, sessions] = await Promise.all([db.tasks.listNotes(row.id), db.sessions.list({ taskId: row.id, status: ['active'] })])
      task = taskView(ctx, row, notes, sessions)
    }
    return c.json(buildContext({
      now: Date.now(),
      actor: principal.actor,
      capabilities: [...principal.capabilities],
      project,
      task,
      inProgress: summaries.filter((summary) => summary.status === 'in_progress'),
      next: chosen ? summaries.find((summary) => summary.id === chosen.id) ?? null : null,
      scans: scansFor([project]),
      environments,
      services,
    }))
  })

  // --- attributed resources ---------------------------------------------------

  app.get('/projects/:slug/resources', documentRoute({
    tag: 'Projects', operationId: 'getProjectResources', capability: 'metrics:read',
    summary: "A project's resource usage, attributed through its environments",
    description: 'Host → Project → Environment → Container, summed from the collector over the environments this project adopted. Unattributed usage is not counted here.',
    response: ProjectResources, parameters: [slugParameter], errors: [404, 500, 503],
  }), async (c) => {
    const db = requireDatabase(deps.db)
    const project = await projectNamed(db, c.req.param('slug'))
    const metrics = readCurrentMetrics(deps.config)
    const adopted = new Set(project.environments.map((link) => link.environment))
    const environments = metrics.projects
      .filter((measured) => adopted.has(measured.composeProject))
      .map((measured) => ({
        environment: measured.composeProject,
        project: project.slug,
        cpuUtilisation: measured.cpuUtilisation,
        memoryUsedBytes: measured.memoryUsedBytes,
        containerCount: measured.containerCount,
        containers: measured.containers.map((container) => ({
          id: container.id, name: container.name, service: container.service,
          cpuUtilisation: container.cpuUtilisation, memoryUsedBytes: container.memoryUsedBytes, memoryLimitBytes: container.memoryLimitBytes,
        })),
      }))
    const sum = (pick: (e: (typeof environments)[number]) => number | null) => {
      const values = environments.map(pick).filter((v): v is number => v !== null)
      return values.length === 0 ? null : values.reduce((a, b) => a + b, 0)
    }
    return c.json({
      project: project.slug,
      collectedAt: metrics.collectedAt,
      stale: metrics.stale,
      collectorActive: metrics.collectorActive,
      cpuUtilisation: sum((e) => e.cpuUtilisation),
      memoryUsedBytes: sum((e) => e.memoryUsedBytes),
      hostMemoryTotalBytes: metrics.host?.memoryTotalBytes ?? null,
      environments,
    })
  })

  // --- the Development Dashboard ----------------------------------------------

  app.get('/overview', documentRoute({
    tag: 'Status', operationId: 'getDevelopmentOverview', capability: 'project:read',
    summary: 'The Development Dashboard: what is happening on this host',
    description: 'Work in progress, active sessions, what needs attention, each project at a glance, recent code, the runtime and the resources. Without a database the work, session and project sections are empty and everything else still answers.',
    response: DevelopmentOverview, errors: [500, 502],
  }), async (c) => {
    const snapshot = await deps.cache.get()
    const overrides = await loadOverrides(deps.db)
    const environments = applyOverrides(snapshot.environments, overrides)
    const metrics = readCurrentMetrics(deps.config)
    const shares = listShares(deps.config, snapshot)
    const gateway = gatewayStatus(snapshot, deps.config)
    const problems = problemsOnly(diagnose(
      snapshot, deps.config, null, shares,
      deps.db.status(),
      loadAliases(deps.config), githubStatusOf(deps),
    ))

    let list: Project[] = []
    let tasks: TaskSummary[] = []
    let sessions: ReturnType<typeof sessionView>[] = []
    const lastActivity = new Map<string, { at: number; summary: string }>()
    const db = deps.db
    if (db && db.status().available) {
      list = await projects(db)
      const rows = await db.tasks.list({ limit: 2000 })
      tasks = taskSummaries(await loadTaskContext(deps.config, db, snapshot, rows), rows)
      const names = await loadNames(db)
      sessions = (await db.sessions.list({ status: ['active'], limit: 100 })).map((row) => sessionView(names, row))
      for (const event of await db.activity.list({ limit: 300 })) {
        const slug = event.projectId ? names.slugById.get(event.projectId) : undefined
        if (slug && !lastActivity.has(slug)) lastActivity.set(slug, { at: seconds(event.at), summary: event.summary })
      }
    }

    return c.json(buildOverview({
      now: Date.now(),
      projects: list,
      environments,
      tasks,
      sessions,
      scans: scansFor(list),
      metrics,
      problems,
      gatewayUp: gateway.up,
      lastActivity,
    }))
  })

  return app
}

