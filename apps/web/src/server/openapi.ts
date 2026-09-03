import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import type { ApiCapability } from 'portta-core'
import { requireCapability } from './principal.ts'
import { HTTPException } from 'hono/http-exception'
import { describeRoute, generateSpecs, resolver } from 'hono-openapi'
import type { DescribeRouteOptions, GenerateSpecOptions } from 'hono-openapi'
import type { OpenAPIV3_1 } from 'openapi-types'
import { z } from 'zod'
import { ApiError, LiveEvent } from '../shared/types.ts'
import type { PanelConfig } from './config.ts'

export type ApiTag =
  | 'Status'
  | 'Projects'
  | 'Repositories'
  | 'Environments'
  | 'Issues'
  | 'Tasks'
  | 'Sessions'
  | 'Activity'
  | 'Services'
  | 'Docker'
  | 'Network'
  | 'Access'
  | 'Shares'
  | 'Gateway'
  | 'Configuration'
  | 'Events'
  | 'Integrations'
  | 'Documentation'
  | 'Authentication'

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503

export interface RouteDocumentation {
  tag: ApiTag
  operationId: string
  /** What a caller must hold. Published as x-portta-capability and checked before the handler runs. */
  capability: ApiCapability
  summary: string
  description?: string
  response: z.ZodType
  status?: number
  responseDescription?: string
  mediaType?: string
  example?: unknown
  parameters?: OpenAPIV3_1.ParameterObject[]
  request?: z.ZodType
  requestDescription?: string
  errors?: ErrorStatus[]
}

const ERROR_DESCRIPTIONS: Record<ErrorStatus, string> = {
  400: 'The request is invalid or the requested action was refused.',
  401: 'The delivery signature could not be verified.',
  403: 'The panel is read-only, the write is cross-origin, or the operation is outside the panel allowlist.',
  404: 'The requested project, service, container, share or endpoint does not exist.',
  409: 'The requested operation conflicts with the current runtime state.',
  500: 'The panel encountered an unexpected failure.',
  502: 'Docker, Traefik or another local upstream returned an error.',
  503: 'A required local dependency is unavailable.',
}

function errorResponse(status: ErrorStatus) {
  return {
    description: ERROR_DESCRIPTIONS[status],
    content: { 'application/json': { schema: resolver(ApiError) } },
  }
}

function requestSchema(schema: z.ZodType): OpenAPIV3_1.SchemaObject {
  const generated = z.toJSONSchema(schema, { target: 'draft-2020-12' })
  const { $schema: _dialect, ...inline } = generated
  return inline as OpenAPIV3_1.SchemaObject
}

export function documentRoute(doc: RouteDocumentation): MiddlewareHandler {
  const status = String(doc.status ?? 200)
  const mediaType = doc.mediaType ?? 'application/json'
  const responses: NonNullable<DescribeRouteOptions['responses']> = {
    [status]: {
      description: doc.responseDescription ?? 'Successful response.',
      content: {
        [mediaType]: {
          schema: resolver(doc.response),
          ...(doc.example === undefined ? {} : { example: doc.example }),
        },
      },
    },
  }
  for (const error of doc.errors ?? [500]) responses[String(error)] = errorResponse(error)

  const spec: DescribeRouteOptions = {
    tags: [doc.tag],
    operationId: doc.operationId,
    summary: doc.summary,
    description: doc.description,
    parameters: doc.parameters,
    responses,
    security: [{}, { cookieAuth: [] }, { basicAuth: [] }, { bearerAuth: [] }],
  }
  if (doc.request) {
    spec.requestBody = {
      required: true,
      description: doc.requestDescription,
      content: { 'application/json': { schema: requestSchema(doc.request) } },
    }
  }
  CAPABILITY_BY_OPERATION.set(doc.operationId, doc.capability)
  // hono-openapi finds a documented route by a marker it puts on the
  // middleware it returns, so the capability check wraps that middleware and
  // carries the marker across rather than hiding it behind a combinator.
  const described = describeRoute(spec)
  const guarded: MiddlewareHandler = async (c, next) => {
    requireCapability(c, doc.capability)
    return described(c, next)
  }
  for (const key of Reflect.ownKeys(described)) {
    const descriptor = Object.getOwnPropertyDescriptor(described, key)
    if (descriptor && key !== 'length' && key !== 'name' && key !== 'prototype') Object.defineProperty(guarded, key, descriptor)
  }
  return guarded
}

/** Every documented operation and the capability it declared, for the contract. */
export const CAPABILITY_BY_OPERATION = new Map<string, ApiCapability>()

/** Stamp x-portta-capability on each operation, from what documentRoute recorded. */
function withCapabilities<T extends { paths?: Record<string, unknown> }>(document: T): T {
  for (const path of Object.values(document.paths ?? {})) {
    if (!path || typeof path !== 'object') continue
    for (const operation of Object.values(path as Record<string, unknown>)) {
      if (!operation || typeof operation !== 'object') continue
      const op = operation as Record<string, unknown>
      const capability = typeof op['operationId'] === 'string' ? CAPABILITY_BY_OPERATION.get(op['operationId']) : undefined
      if (capability) op['x-portta-capability'] = capability
    }
  }
  return document
}

export const containerIdParameter: OpenAPIV3_1.ParameterObject = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Docker container id, not a Compose service name.',
  schema: { type: 'string' },
}

export const projectParameter: OpenAPIV3_1.ParameterObject = {
  name: 'project',
  in: 'path',
  required: true,
  description: 'COMPOSE_PROJECT_NAME of a running project.',
  schema: { type: 'string' },
}

export const shareIdParameter: OpenAPIV3_1.ParameterObject = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Opaque share id returned when the share was created.',
  schema: { type: 'string' },
}

export const bridgeIdParameter: OpenAPIV3_1.ParameterObject = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Gateway-owned bridge container id returned when the bridge was opened.',
  schema: { type: 'string' },
}

export const tailParameter: OpenAPIV3_1.ParameterObject = {
  name: 'tail',
  in: 'query',
  required: false,
  description: 'Maximum number of log lines, clamped to 1–2000.',
  schema: { type: 'integer', minimum: 1, maximum: 2000, default: 200 },
}

export const OpenApiDocument = z.object({
  openapi: z.literal('3.1.0'),
  info: z.object({ title: z.string(), version: z.string() }).passthrough(),
  paths: z.record(z.string(), z.unknown()),
  components: z.record(z.string(), z.unknown()).optional(),
}).passthrough().meta({ ref: 'OpenApiDocument' })

const HtmlDocument = z.string().describe('Self-contained HTML document with no external assets')

export function openApiOptions(version: string): Partial<GenerateSpecOptions> {
  return { excludeStaticFile: false, documentation: {
    info: {
      title: 'Portta panel API',
      version,
      summary: 'Runtime inventory and bounded control for Portta.',
      description:
        'The API used by the panel UI, the CLI and local agents. Every operation declares the capability it needs (x-portta-capability); read-only mode holds every read, and an agent that announces itself with X-Portta-Actor holds what the agentCapabilities setting grants. Writes can also be refused by the same-origin guard. Authentication, when enabled, is enforced by Traefik before a request reaches this application.',
      license: { name: 'MIT' },
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    servers: [{ url: '/api', description: 'This panel instance' }],
    tags: [
      { name: 'Status', description: 'Liveness and overview.' },
      { name: 'Projects', description: 'The product the operator recognises. Persisted. See ADR 0031.' },
      { name: 'Repositories', description: "A Project's code: registered here, observed by the host scan. GitHub is optional metadata on it." },
      { name: 'Environments', description: 'Compose environments running on this host.' },
      { name: 'Issues', description: 'The GitHub issue projection, and writes that go back to GitHub.' },
      { name: 'Tasks', description: "Portta's own unit of work. Local-first; a GitHub issue is an optional binding. What is next, take it, note, finish." },
      { name: 'Sessions', description: 'Who is working on what, since when, and what came out. A person or an agent.' },
      { name: 'Activity', description: 'What happened in the development flow: tasks, sessions, commits, environments. Not a log.' },
      { name: 'Services', description: 'Containers belonging to adopted projects.' },
      { name: 'Docker', description: 'Bounded host inventory and lifecycle operations.' },
      { name: 'Network', description: 'Routes, networks, DNS, TLS and VPN state.' },
      { name: 'Access', description: 'Temporary loopback bridges to private TCP services.' },
      { name: 'Shares', description: 'Expiring per-service Traefik routes.' },
      { name: 'Gateway', description: 'Gateway components, diagnostics and logs.' },
      { name: 'Configuration', description: 'The closed settings catalogue.' },
      { name: 'Events', description: 'Server-sent runtime events.' },
      { name: 'Integrations', description: 'Outbound integrations and their projections.' },
      { name: 'Documentation', description: 'The machine contract and its offline browser.' },
      { name: 'Authentication', description: 'Revocable Bearer credentials for remote CLI and coding agents.' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: '__portta_session',
          description:
            'Host-scoped session issued by the Portta login page. Traefik validates it through ForwardAuth before forwarding the request.',
        },
        basicAuth: {
          type: 'http',
          scheme: 'basic',
          description:
            'Compatibility path for API clients, health checks and webhooks. Traefik validates it through Portta ForwardAuth before forwarding the request.',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'A revocable Portta API token. The raw credential is shown only when it is created.',
        },
      },
    },
  } }
}

export async function generateOpenApi(api: Hono, version: string) {
  return withCapabilities(await generateSpecs(api, openApiOptions(version)))
}

export function registerOpenApiRoutes(api: Hono, config: PanelConfig): void {
  api.get(
    '/openapi.json',
    documentRoute({
      tag: 'Documentation',
      operationId: 'getOpenApiDocument',
      capability: 'gateway:read',
      summary: 'Return the OpenAPI 3.1 contract',
      response: OpenApiDocument,
      responseDescription: 'The contract generated from the registered routes.',
    }),
    async (c) => c.json(await generateOpenApi(api, config.gatewayVersion)),
  )

  /**
   * Kept so `docs/web-ui.md`, muscle memory and any bookmark keep working. The
   * browser itself moved into the documentation site, where it shares the
   * panel's themes, its typography and its navigation instead of being a
   * separate 58-line page nobody could style.
   */
  api.get(
    '/docs',
    documentRoute({
      tag: 'Documentation',
      operationId: 'browseApiDocumentation',
      capability: 'gateway:read',
      summary: 'Redirect to the API reference',
      description: 'The reference lives at /docs/api, inside the documentation site. Available by default on loopback and opt-in when the panel is routed.',
      response: HtmlDocument,
      mediaType: 'text/html',
      status: 302,
      errors: [404],
    }),
    (c) => {
      if (!config.apiDocs) throw new HTTPException(404, { message: 'the API browser is disabled' })
      return c.redirect('/docs/#/api', 302)
    },
  )
}

export const eventStreamResponse = LiveEvent.describe(
  'Schema of the JSON value in each SSE data frame. Keepalive ping frames contain a Unix timestamp string.',
)
