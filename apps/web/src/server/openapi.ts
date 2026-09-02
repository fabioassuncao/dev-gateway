import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { describeRoute, generateSpecs, resolver } from 'hono-openapi'
import type { DescribeRouteOptions, GenerateSpecOptions } from 'hono-openapi'
import type { OpenAPIV3_1 } from 'openapi-types'
import { z } from 'zod'
import { ApiError, LiveEvent } from '../shared/types.ts'
import type { PanelConfig } from './config.ts'
import { apiDocsHtml } from './openapi-docs.ts'

export type ApiTag =
  | 'Status'
  | 'Projects'
  | 'Workspaces'
  | 'Issues'
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

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503

export interface RouteDocumentation {
  tag: ApiTag
  operationId: string
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
    security: [{}, { cookieAuth: [] }, { basicAuth: [] }],
  }
  if (doc.request) {
    spec.requestBody = {
      required: true,
      description: doc.requestDescription,
      content: { 'application/json': { schema: requestSchema(doc.request) } },
    }
  }
  return describeRoute(spec)
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
        'The API used by the panel UI and by local agents. Writes can be refused by read-only mode or the same-origin guard. Authentication, when enabled, is enforced by Traefik before a request reaches this application.',
      license: { name: 'MIT' },
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    servers: [{ url: '/api', description: 'This panel instance' }],
    tags: [
      { name: 'Status', description: 'Liveness and overview.' },
      { name: 'Projects', description: 'Compose projects adopted by the gateway.' },
      { name: 'Workspaces', description: 'Groupings a person created: repositories and the environments they own.' },
      { name: 'Issues', description: 'The GitHub issue projection, and writes that go back to GitHub.' },
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
      },
    },
  } }
}

export async function generateOpenApi(api: Hono, version: string) {
  return generateSpecs(api, openApiOptions(version))
}

export function registerOpenApiRoutes(api: Hono, config: PanelConfig): void {
  api.get(
    '/openapi.json',
    documentRoute({
      tag: 'Documentation',
      operationId: 'getOpenApiDocument',
      summary: 'Return the OpenAPI 3.1 contract',
      response: OpenApiDocument,
      responseDescription: 'The contract generated from the registered routes.',
    }),
    async (c) => c.json(await generateOpenApi(api, config.gatewayVersion)),
  )

  api.get(
    '/docs',
    documentRoute({
      tag: 'Documentation',
      operationId: 'browseApiDocumentation',
      summary: 'Browse and try the API locally',
      description: 'Available by default on loopback and opt-in when the panel is routed. All assets are inline.',
      response: HtmlDocument,
      mediaType: 'text/html',
      errors: [404],
    }),
    (c) => {
      if (!config.apiDocs) throw new HTTPException(404, { message: 'the API browser is disabled' })
      return c.html(apiDocsHtml)
    },
  )
}

export const eventStreamResponse = LiveEvent.describe(
  'Schema of the JSON value in each SSE data frame. Keepalive ping frames contain a Unix timestamp string.',
)
