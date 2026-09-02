# MCP: the task verbs, for an agent

`portta mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server. It speaks stdio to an agent and HTTP to the panel, and it registers
eight tools — the task verbs from [the API](web-ui.md#api).

The point of it is what the agent *does not* get: **no GitHub credential**. The
App's private key stays a file the panel mounts read-only, installation tokens
live for an hour in the panel's memory, and the agent holds stdio to a process
that knows a panel URL. Nothing about GitHub reaches the agent's configuration,
and a test asserts it cannot.

```text
Agent  ──stdio──>  portta mcp  ──HTTP──>  Portta panel  ──App auth──>  GitHub
                                              │
                                        the projection
```

## Configure it

`portta mcp` needs a running panel with the GitHub App configured
([github.md](github.md)) and at least one workspace owning a repository.

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
| `--actor <name>`, `PORTTA_MCP_ACTOR` | Recorded on every write as `X-Portta-Actor`, in the panel's log. Never forwarded to GitHub |
| `PORTTA_WEB_AUTH_USER` + `PORTTA_PANEL_PASSWORD` | The panel credential, when the panel is authenticated |

`portta mcp` refuses a non-loopback panel URL unless you pass `--allow-remote`,
because that URL is where a credential goes. It is the same posture the rest of
Portta takes about exposure: reachable from elsewhere is a decision, not a
default.

## The tools

| Tool | Reaches | Network |
|---|---|---|
| `list_tasks` | `GET /api/workspaces/:slug/tasks` | Projection only |
| `next_task` | `GET /api/workspaces/:slug/tasks/next` | Projection only |
| `get_task` | `GET /api/tasks/:ref` | Projection only |
| `get_subtasks` | `GET /api/tasks/:ref/subtasks` | Projection only |
| `start_task` | `POST /api/tasks/:ref/start` | GitHub |
| `set_task_status` | `POST /api/tasks/:ref/status` | GitHub |
| `comment_task` | `POST /api/tasks/:ref/comments` | GitHub |
| `finish_task` | `POST /api/tasks/:ref/finish` | GitHub |

One tool, one endpoint. No tool composes two calls: a workflow that needs
composing composes in the API, where it can be tested without a transport. A
tool here growing a second request is the signal to add a verb to the API.

A task is addressed as **`owner/repo#number`** — the coordinate that is already
in the branch name, the commit message and the URL — or by its projected id.

### What `next_task` means

Stated once, so it can be argued with:

1. status is `ready` — `backlog` is not triaged, `in_progress` is somebody's;
2. it is open, and not a pull request;
3. nothing under it is unfinished (a parent with open sub-issues is not work:
   the children are the tasks);
4. it is unassigned, or assigned to `--actor`;
5. then by priority, urgent first, unprioritised last;
6. then by how long it has waited, so a task nobody picks up rises rather than
   starving.

It answers `null` when there is nothing to do. That is an answer, not an error.

### What a write does

`start_task` sets the status to `in_progress` **and** assigns the actor, in one
confirmed write, so a task is never half-taken — an assignment is what stops
`next_task` offering it to somebody else. `finish_task` sets `done` and closes
the issue only when asked.

Every write reaches GitHub first and updates the projection **from what GitHub
returned**, never from what was requested. The repository projection is the
authorisation boundary: a coordinate for a repository the installation never
granted is refused before a request leaves the host.

## What an agent cannot do through this

- **Read comments.** They are never projected; `comment_task` writes one and
  returns what GitHub returned. Reading a discussion is a link to GitHub.
  See [github.md](github.md#issues-and-how-they-stay-in-step).
- **See GitHub Projects v2 fields.** A repository whose board lives in a
  Project is invisible to the projection.
- **Touch anything but issues.** No container, no volume, no environment: the
  panel's Docker surface is not exposed here.
- **Reach a repository the App was not installed on.**
- **Hold a GitHub credential.**

## When something fails

The tools carry the panel's answer through as words, because an agent needs to
tell "you asked for something impossible" from "try again later":

| The panel said | The tool says |
|---|---|
| 400 | `refused: …` — the request will never succeed as written |
| 401, 403 | `not permitted: …` — read-only mode, or no App configured |
| 404 | `not found: …` — including a coordinate outside the projection |
| 503 | `temporarily unavailable, and worth retrying: …` — a GitHub outage or an exhausted rate limit |
| nothing | the panel URL, and why the connection failed |

Read-only mode (`portta web up --read-only`) refuses every write verb and
leaves every read working, which makes it a reasonable way to give an agent a
look at the board and nothing more.

## Related

- [GitHub](github.md) — the App, the projection, and how issues stay in step
- [Web UI](web-ui.md) — the same tasks, for a person
- [CLI contract](cli.md) — `portta mcp` among the other commands
- [ADR 0018](adr/0018-github-access-lives-in-the-panel.md) — why GitHub access
  lives in the panel, and the 2026-09-02 amendment that allows a write-through
  comment
