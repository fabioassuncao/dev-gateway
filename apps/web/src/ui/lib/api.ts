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
  ProjectLogsResponse,
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
