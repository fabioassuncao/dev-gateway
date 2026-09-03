# MCP: Portta, for an agent

`portta mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server. It speaks stdio to an agent and HTTP to the panel, and it registers
twenty-seven tools — one endpoint each — over the same API the panel and the
CLI use.

The point of it is what the agent *does not* get: **no GitHub credential and
no Docker socket**. The App's private key stays a file the panel mounts
read-only, installation tokens live for an hour in the panel's memory, the
container lifecycle stays behind the panel's allowlist, and the agent holds
stdio to a process that knows a panel URL.

```text
Agent  ──stdio──>  portta mcp  ──HTTP──>  Portta panel  ──App auth──>  GitHub
                                              │
                                        Projects, tasks, sessions, activity
                                        Docker · Git scan · metrics
```

## Configure it

`portta mcp` needs a running panel with its database (`portta web up`).
GitHub is optional: without the App, everything below works except the
verbs that reach github.com.

```jsonc
{
  "mcpServers": {
    "portta": {
      "command": "portta",
      "args": ["mcp", "--actor", "claude-code"],
      "env": {
        // Only when the panel is authenticated. Omitted for a loopback panel
        // with no credential, which is the default.
        "PORTTA_WEB_AUTH_USER": "dev",
        "PORTTA_PANEL_PASSWORD": "…"
      }
    }
  }
}
```

For Claude Code, the same thing in one command:

```bash
claude mcp add portta -- portta mcp --actor claude-code
```

| Flag / variable | What it does |
|---|---|
| `--url <url>`, `PORTTA_PANEL_URL` | The panel API base. Defaults to `http://127.0.0.1:<PORTTA_WEB_PORT>` |
| `--allow-remote` | Permit a non-loopback panel URL. **Required** for one: that URL is where the panel credential would be sent |
| `--actor <name>`, `PORTTA_MCP_ACTOR` | Sent on every call as `X-Portta-Actor`. Recorded on tasks, notes, sessions and activity; never forwarded to GitHub |
| `PORTTA_WEB_AUTH_USER` + `PORTTA_PANEL_PASSWORD` | The panel credential, when the panel is authenticated |

`portta mcp` refuses a non-loopback panel URL unless you pass `--allow-remote`,
because that URL is where a credential goes.

## What the actor means

`X-Portta-Actor` is self-declared. It does not authenticate anything — the
panel credential did that — it says *which* caller behind that credential
this is. Two things follow:

- every task, note, session and activity event carries the name, so a person
  reading the panel from elsewhere can tell what an agent did;
- an agent that announces itself holds the capabilities of the
  `agentCapabilities` setting rather than the operator's. By default that is
  everything except destroying an environment or a container, writing the
  gateway configuration, and opening a network path. A refused call answers
  `not permitted` with the capability named. See
  [ADR 0032](adr/0032-portta-development-model.md).

## The tools

Reads, all local to the panel:

| Tool | Reaches |
|---|---|
| `list_projects` | `GET /api/projects` |
| `get_project` | `GET /api/projects/:slug` |
| `get_context` | `GET /api/projects/:slug/context` — the Development Context, below |
| `list_repositories` | `GET /api/projects/:slug/repositories` |
| `get_repository_git` | `GET /api/repositories/:id/git` — branch, HEAD, dirty counts, recent commits, instruction files |
| `list_environments` | `GET /api/environments` |
| `get_environment` | `GET /api/environments/:name` |
| `list_services` | `GET /api/environments/:name/services` — one row per service with its access, resources and actions |
| `get_logs` | `GET /api/environments/:name/logs` |
| `get_resources` | `GET /api/metrics/current` |
| `list_activity` | `GET /api/activity` |

Work:

| Tool | Reaches | Network |
|---|---|---|
| `list_tasks` | `GET /api/projects/:slug/tasks` | — |
| `next_task` | `GET /api/projects/:slug/tasks/next` | — |
| `get_task` | `GET /api/tasks/:ref` | — |
| `get_subtasks` | `GET /api/tasks/:ref/subtasks` | — |
| `create_task` | `POST /api/projects/:slug/tasks` | — |
| `start_task` | `POST /api/tasks/:ref/start` | GitHub, when the task is bound |
| `set_task_status` | `POST /api/tasks/:ref/status` | GitHub, when bound |
| `finish_task` | `POST /api/tasks/:ref/finish` | GitHub, when bound |
| `add_task_note` | `POST /api/tasks/:ref/notes` | — |
| `link_task` | `POST /api/tasks/:ref/github/link` | — |
| `comment_task` | `POST /api/tasks/:ref/comments` | GitHub |
| `start_session` | `POST /api/projects/:slug/sessions` | — |
| `end_session` | `PATCH /api/sessions/:id` | — |

Operation, gated by capability:

| Tool | Reaches |
|---|---|
| `start_environment` | `POST /api/environments/:name/actions/start` |
| `stop_environment` | `POST /api/environments/:name/actions/stop` |
| `restart_service` | `POST /api/environments/:name/services/:service/actions/restart` |

One tool, one endpoint. No tool composes two calls: a workflow that needs
composing composes in the API, where it can be tested without a transport.

A task is addressed by its id (`42`, `#42`) or, when it is bound to a GitHub
issue, by **`owner/repo#number`** — the coordinate that is already in the
branch name, the commit message and the URL.

### The Development Context

`get_context` is what an agent reads before it works. One answer carries:

- the Project: name, description, path;
- its repositories, each with git state, the git root on the host, the
  environments it runs from, and the **instruction files** the host
  collected (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, …) with their
  content;
- the environments it adopted, with their services, primary addresses and
  the commands that start, stop and read their logs;
- the work: what is in progress and what `next_task` would answer;
- the effective instructions — the rules of a shared development host, the
  project's note, every repository's files, and the task named with
  `task:` — in the order an agent should read them;
- the CLI verbs that matter here, ready to copy.

### What `next_task` means

Stated once, so it can be argued with:

1. status is `ready` — `backlog` is not triaged, `in_progress` is somebody's;
2. nothing under it is unfinished (a parent with open subtasks is not work:
   the children are the tasks);
3. it is unassigned, or assigned to `--actor`;
4. then by priority, urgent first, unprioritised last;
5. then by how long it has waited, so a task nobody picks up rises rather
   than starving.

It answers `null` when there is nothing to do. That is an answer, not an error.

### What a write does

`start_task` sets the status to `in_progress` **and** assigns the actor, in
one write, so a task is never half-taken. `finish_task` sets `done` and, when
asked, closes the bound issue.

A task is Portta's own. A write to an unbound task is local. A write to a
task bound to a GitHub issue reaches GitHub first and the row second; when
the App is unavailable the row is written anyway and the binding is marked
`pending` until the next sync. A remote change that lands on a pending local
edit is a `conflict`, kept and shown, never resolved silently.

## What an agent cannot do through this

- **Read GitHub comments.** They are never projected; `comment_task` writes
  one. Reading a discussion is a link to GitHub.
- **Destroy anything**, by default: removing an environment, a container or a
  volume needs a capability the operator grants explicitly.
- **Reach a repository the App was not installed on**, or publish a task to
  a repository its Project does not own.
- **Hold a GitHub credential, or the Docker socket.**

## When something fails

The tools carry the panel's answer through as words, because an agent needs to
tell "you asked for something impossible" from "try again later":

| The panel said | The tool says |
|---|---|
| 400 | `refused: …` — the request will never succeed as written |
| 401, 403 | `not permitted: …` — read-only mode, a capability the actor does not hold, or no App configured |
| 404 | `not found: …` |
| 503 | `temporarily unavailable, and worth retrying: …` — the database, a GitHub outage or an exhausted rate limit |
| nothing | the panel URL, and why the connection failed |

Read-only mode (`portta web up --read-only`) refuses every write verb and
leaves every read working, which makes it a reasonable way to give an agent a
look and nothing more.

## Related

- [CLI contract](cli.md) — the same verbs, for a terminal
- [GitHub](github.md) — the App, the projection, and how a bound task stays in step
- [Web UI](web-ui.md) — the same work, for a person
- [ADR 0032](adr/0032-portta-development-model.md) — the model this serves
