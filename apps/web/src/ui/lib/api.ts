import type {
  AccessView,
  ConfigPatchResult,
  ConfigView,
  ContainerSummary,
  Diagnostic,
  DockerHost,
  GatewayStatus,
  LogsResponse,
  NetworkView,
  Overview,
  Project,
  ProjectGit,
  GitHubIntegrationView,
  GitHubRepositoryView,
  Issue,
  Workspace,
  WorkspaceSummary,
  ProjectLogsResponse,
  ProjectOverrides,
  ServiceOverrides,
  RemovalPreview,
  Share,
  ServiceTraefik,
  ShareView,
  TraefikVerdict,
} from '../../shared/types.ts'

export class ApiError extends Error {
  status: number
  hint: string
  constructor(status: number, message: string, hint = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.hint = hint
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : null

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; hint?: string }
    throw new ApiError(response.status, body.error ?? response.statusText, body.hint ?? '')
  }
  return payload as T
}

export const api = {
  overview: () => request<Overview>('/status'),
  gateway: () => request<GatewayStatus>('/gateway'),
  doctor: () =>
    request<{ checks: Diagnostic[]; failures: number; warnings: number; ranAt: number; hostCommand: string }>(
      '/gateway/doctor',
      { method: 'POST', body: '{}' },
    ),
  gatewayLogs: (component: string, tail = 200) =>
    request<LogsResponse>(`/gateway/logs?component=${encodeURIComponent(component)}&tail=${tail}`),
  restartGateway: (components: string[]) =>
    request<{ ok: boolean; restarted: string[]; note: string; applyCommand: string }>('/gateway/restart', {
      method: 'POST',
      body: JSON.stringify({ components }),
    }),

  projects: () => request<{ projects: Project[] }>('/projects').then((data) => data.projects),
  project: (name: string) => request<Project>(`/projects/${encodeURIComponent(name)}`),
  projectGit: (name: string) => request<ProjectGit>(`/projects/${encodeURIComponent(name)}/git`),
  projectLogs: (name: string, options: { tail?: number; service?: string | null } = {}) => {
    const query = new URLSearchParams()
    if (options.tail !== undefined) query.set('tail', String(options.tail))
    if (options.service) query.set('service', options.service)
    const suffix = query.toString()
    return request<ProjectLogsResponse>(
      `/projects/${encodeURIComponent(name)}/logs${suffix ? `?${suffix}` : ''}`,
    )
  },
  projectSettings: (name: string) =>
    request<ProjectOverrides>(`/projects/${encodeURIComponent(name)}/settings`),
  setProjectSettings: (name: string, body: Record<string, unknown>) =>
    request<ProjectOverrides>(`/projects/${encodeURIComponent(name)}/settings`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  clearProjectSettings: (name: string) =>
    request<{ ok: boolean; cleared: string[] }>(`/projects/${encodeURIComponent(name)}/settings`, {
      method: 'DELETE',
      body: '{}',
    }),
  serviceAlias: (name: string, service: string, alias: string) =>
    request<{ host: string; derivedHosts: string[]; port: number }>(
      `/projects/${encodeURIComponent(name)}/services/${encodeURIComponent(service)}/alias`,
      { method: 'PUT', body: JSON.stringify({ alias }) },
    ),
  clearServiceAlias: (name: string, service: string) =>
    request<{ ok: boolean; removed: string | null }>(
      `/projects/${encodeURIComponent(name)}/services/${encodeURIComponent(service)}/alias`,
      { method: 'DELETE', body: '{}' },
    ),
  serviceOverrides: (name: string, service: string) =>
    request<ServiceOverrides>(
      `/projects/${encodeURIComponent(name)}/services/${encodeURIComponent(service)}/overrides`,
    ),

  github: () => request<GitHubIntegrationView>('/integrations/github'),
  githubRepositories: () =>
    request<{ repositories: GitHubRepositoryView[] }>('/integrations/github/repositories').then(
      (data) => data.repositories,
    ),
  syncGitHub: () =>
    request<{ ok: boolean; installations: number; repositories: number; removed: number }>(
      '/integrations/github/sync',
      { method: 'POST', body: '{}' },
    ),

  workspaceIssues: (slug: string, filters: Record<string, string> = {}) => {
    const query = new URLSearchParams(filters)
    const suffix = query.toString()
    return request<{ issues: Issue[] }>(
      `/workspaces/${encodeURIComponent(slug)}/issues${suffix ? `?${suffix}` : ''}`,
    ).then((data) => data.issues)
  },
  issue: (id: string) => request<Issue>(`/issues/${encodeURIComponent(id)}`),
  createIssue: (fullName: string, body: Record<string, unknown>) =>
    request<Issue>(`/repositories/${fullName.split('/').map(encodeURIComponent).join('/')}/issues`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setIssueEnvironments: (id: string, environments: string[]) =>
    request<Issue>(`/issues/${encodeURIComponent(id)}/environments`, {
      method: 'PUT',
      body: JSON.stringify({ environments }),
    }),
  patchIssue: (id: string, body: Record<string, unknown>) =>
    request<Issue>(`/issues/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),

  workspaces: () =>
    request<{ workspaces: WorkspaceSummary[] }>('/workspaces').then((data) => data.workspaces),
  workspace: (slug: string) => request<Workspace>(`/workspaces/${encodeURIComponent(slug)}`),
  createWorkspace: (body: { slug: string; name: string; description: string | null }) =>
    request<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify(body) }),
  patchWorkspace: (slug: string, body: Record<string, unknown>) =>
    request<WorkspaceSummary>(`/workspaces/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteWorkspace: (slug: string) =>
    request<{ ok: boolean; removed: string; note: string }>(`/workspaces/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      body: '{}',
    }),
  setWorkspaceRepositories: (slug: string, repositories: { fullName: string; role?: string | null }[]) =>
    request<Workspace>(`/workspaces/${encodeURIComponent(slug)}/repositories`, {
      method: 'PUT',
      body: JSON.stringify({ repositories }),
    }),
  setWorkspaceEnvironments: (slug: string, environments: string[]) =>
    request<Workspace>(`/workspaces/${encodeURIComponent(slug)}/environments`, {
      method: 'PUT',
      body: JSON.stringify({ environments }),
    }),

  services: () => request<{ services: ContainerSummary[] }>('/services').then((data) => data.services),
  serviceTraefik: (id: string) => request<ServiceTraefik>(`/services/${encodeURIComponent(id)}/traefik`),
  traefik: () => request<TraefikVerdict>('/gateway/traefik'),

  containers: (params: { ownership?: string; state?: string; q?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.ownership && params.ownership !== 'all') query.set('ownership', params.ownership)
    if (params.state && params.state !== 'all') query.set('state', params.state)
    if (params.q) query.set('q', params.q)
    const suffix = query.toString()
    return request<{ containers: ContainerSummary[]; total: number }>(
      `/docker/containers${suffix ? `?${suffix}` : ''}`,
    )
  },
  container: (id: string) => request<ContainerSummary>(`/docker/containers/${id}`),
  logs: (id: string, tail = 200) => request<LogsResponse>(`/docker/containers/${id}/logs?tail=${tail}`),
  stats: (id: string) =>
    request<{ cpuPercent: number | null; memoryBytes: number | null; memoryLimit: number | null }>(
      `/docker/containers/${id}/stats`,
    ),
  removalPreview: (id: string) => request<RemovalPreview>(`/docker/containers/${id}/removal-preview`),
  containerAction: (id: string, action: 'start' | 'stop' | 'restart') =>
    request<{ ok: boolean; message: string }>(`/docker/containers/${id}/${action}`, {
      method: 'POST',
      body: '{}',
    }),
  removeContainer: (id: string, force: boolean) =>
    request<{ ok: boolean; message: string }>(`/docker/containers/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true, force }),
    }),
  host: () => request<DockerHost>('/docker/host'),

  network: () => request<NetworkView>('/network'),

  access: () => request<AccessView>('/access'),
  openBridge: (body: { project: string; service: string; port?: number; ttlSeconds?: number }) =>
    request<{ ok: boolean }>('/access', { method: 'POST', body: JSON.stringify(body) }),
  closeBridge: (id: string) => request<{ ok: boolean }>(`/access/${id}`, { method: 'DELETE' }),

  shares: () => request<ShareView>('/shares'),
  createShare: (id: string, body: { mode: 'public' | 'protected'; ttlSeconds?: number }) =>
    request<{ ok: boolean; share: Share; password: string | null }>(
      `/services/${encodeURIComponent(id)}/share`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  regenerateShare: (id: string) =>
    request<{ ok: boolean; share: Share; password: string | null }>(
      `/shares/${encodeURIComponent(id)}/regenerate`,
      { method: 'POST', body: '{}' },
    ),
  revokeShare: (id: string) => request<{ ok: boolean }>(`/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  config: () => request<ConfigView>('/config'),
  patchConfig: (values: Record<string, string | null>) =>
    request<ConfigPatchResult>('/config', { method: 'PATCH', body: JSON.stringify({ values }) }),
}
