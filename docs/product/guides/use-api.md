# Use the Portta API

### API contract

The panel publishes an OpenAPI 3.1 contract at
`http://127.0.0.1:8081/api/openapi.json`. It is generated from the same route
registrations and Zod schemas the server and UI use: parameters, request
bodies, response shapes, status codes, read-only refusals and the SSE payload
are all part of the document. It declares the host-scoped Portta session and
the HTTP Basic compatibility path for non-browser clients. Traefik asks the
separate auth process to enforce either one before a request reaches the panel.

`http://127.0.0.1:8081/docs/api` renders that document: operations grouped by
tag, resolved schemas for parameters, request bodies and responses, the
declared security schemes, and a console. `/api/docs` redirects there, so a
bookmark keeps working.

The console executes a `GET` on a click. A `POST`, `PUT`, `PATCH` or `DELETE`
says what it is about to send and waits for a second, explicit confirmation,
because it is a real request against this panel. Read-only mode and the
same-origin write guard come back as the API's own error payload rather than as
a generic failure, so a refusal reads as a refusal.

It is enabled by default only while the panel stays on loopback. A routed panel
returns 404 unless `PORTTA_RUNTIME_API_DOCS=true` explicitly opts in. The JSON
contract stays available because a caller that reached the API can already
inspect it.

`packages/contracts/openapi.json` is checked in so an API change is visible in
review. `npm run openapi:check --workspace=portta-contracts` regenerates it in
memory and fails on byte-level drift. Adding or changing a route therefore
requires updating its attached description and running
`npm run openapi --workspace=portta-contracts`.


See [Authentication](authentication.md#tokens-for-the-cli-and-agents) for personal API tokens. The endpoint reference is served by this panel at `/docs/api`; the machine-readable contract is `/api/openapi.json`.

## Query documentation

The same corpus served at `/docs` is available through authenticated read endpoints:

| Endpoint | Query | Response |
| --- | --- | --- |
| `GET /api/documentation` | Optional `audience` | Version identity, page metadata and navigation |
| `GET /api/documentation/search` | `q`, optional `audience`, `limit` | Ranked results with excerpts and anchors |
| `GET /api/documentation/page` | `slug`, optional `anchor` | Markdown for a page or heading subtree |

`audience` is `user`, `developer` or `all` (default). Search accepts 1–50 results and defaults to 10. A missing page or anchor returns 404; invalid input returns 400. Disabling documentation also disables these endpoints.

```bash
curl --fail --get http://127.0.0.1:8081/api/documentation/search \
  --data-urlencode 'q=custom domain' \
  --data-urlencode 'audience=user'
```

On a protected panel, add an Authorization header using your Portta token. Every response identifies the corpus version and hash. The OpenAPI document describes the complete schemas; `/api/docs` remains the compatibility redirect to the interactive API reference.
