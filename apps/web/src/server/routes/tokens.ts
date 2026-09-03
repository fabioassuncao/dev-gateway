import { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { API_CAPABILITIES, DEFAULT_AGENT_CAPABILITIES, createApiToken, readProtectionStore, revokeApiToken, writeProtectionStore } from 'portta-core'
import type { AppDeps } from './deps.ts'
import { documentRoute } from '../openapi.ts'

const Token = z.object({
  id: z.string(), name: z.string(), actor: z.string(), actorKind: z.enum(['human', 'agent']),
  capabilities: z.array(z.enum(API_CAPABILITIES)), createdAt: z.string(), revokedAt: z.string().nullable(),
}).strict().meta({ ref: 'ApiToken' })
const Tokens = z.object({ tokens: z.array(Token) }).strict().meta({ ref: 'ApiTokens' })
const CreateToken = z.object({
  name: z.string().min(1).max(80), actor: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/),
  actorKind: z.enum(['human', 'agent']).default('agent'), capabilities: z.array(z.enum(API_CAPABILITIES)).optional(),
}).strict().meta({ ref: 'CreateApiToken' })
const CreatedToken = z.object({ token: z.string(), credential: Token }).strict().meta({ ref: 'CreatedApiToken' })

const view = ({ hash: _hash, ...record }: ReturnType<typeof readProtectionStore>['tokens'][number]) => record

export function tokenRoutes(deps: AppDeps): Hono {
  const app = new Hono()
  app.get('/auth/tokens', documentRoute({ tag: 'Authentication', operationId: 'listApiTokens', capability: 'config:read', summary: 'List API tokens without their secrets', response: Tokens, errors: [403, 500] }), (c) => {
    return c.json({ tokens: readProtectionStore(deps.config.authStore).tokens.map(view) })
  })
  app.post('/auth/tokens', documentRoute({ tag: 'Authentication', operationId: 'createApiToken', capability: 'config:write', summary: 'Create a revocable Bearer token', description: 'The raw token appears once. It has no expiry and remains valid until revoked.', request: CreateToken, response: CreatedToken, status: 201, errors: [400, 403, 500] }), async (c) => {
    const body = CreateToken.parse(await c.req.json())
    const created = createApiToken(readProtectionStore(deps.config.authStore), { ...body, capabilities: body.capabilities ?? DEFAULT_AGENT_CAPABILITIES })
    writeProtectionStore(deps.config.authStore, created.store)
    return c.json({ token: created.token, credential: view(created.record) }, 201)
  })
  app.delete('/auth/tokens/:id', documentRoute({ tag: 'Authentication', operationId: 'revokeApiToken', capability: 'config:write', summary: 'Revoke an API token', response: z.object({ ok: z.boolean(), revoked: z.string() }).strict(), errors: [403, 404, 500] }), (c) => {
    const store = readProtectionStore(deps.config.authStore)
    if (!store.tokens.some((token) => token.id === c.req.param('id'))) throw new HTTPException(404, { message: `no API token '${c.req.param('id')}'` })
    writeProtectionStore(deps.config.authStore, revokeApiToken(store, c.req.param('id')))
    return c.json({ ok: true, revoked: c.req.param('id') })
  })
  return app
}
