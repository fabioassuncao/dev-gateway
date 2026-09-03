# GitHub

The panel can authenticate to GitHub as an App, list the installations and
repositories it was granted, and hold them in its own projection. Issues, a
board and the link between an issue and an environment are the phases after
this one. The architecture is decided in
[ADR 0018](adr/0018-github-access-lives-in-the-panel.md).

**It is off by default.** With `GITHUB_APP_ENABLED=false` the panel makes no
request to github.com and behaves exactly as it did before this existed.

## What stays on the host

`portta repos scan` still collects branch, HEAD, dirty counts and
ahead/behind from local `git`, and writes one `state/git/<key>.json` per
repository plus an index that maps each environment to its repository.
The panel only reads that snapshot. No project directory is mounted into
the panel. See [ADR 0010](adr/0010-git-collected-on-the-host.md).

## What will live in the panel

A GitHub App, once configured, reads and writes issues, sub-issues, issue
types, issue fields and pull-request state. Local working trees stay
read-only. A Personal Access Token in `.env` is not the design.

## Source of truth

| Fact | Owner |
|---|---|
| Portta Task title, description, status, priority, labels and assignee | Portta. These fields can be copied explicitly across a GitHub binding; the local Task remains usable and authoritative when GitHub is unavailable |
| Agent, due date, parent, repository/environment/service, board rank and local comments | Portta only |
| GitHub issue state, milestone, field values, sub-issue links and pull-request state | GitHub, held as an external projection |
| Branch, HEAD, dirty counts, ahead/behind | Local `git` on the host |
| Containers, health, URLs, networks | Docker / Traefik on this host |
| Which GitHub repositories a Portta project owns | Portta |
| Which environments a Portta project has adopted | Portta |
| A link from an issue to an environment | Portta |

The panel never treats a Task as a cache of GitHub. A local write commits
first. When a binding exists, the shared fields are then pushed; an unavailable
GitHub leaves the binding `pending` or `error` and never rolls the Task back.
Linking an existing issue also requires an explicit first direction (`pull` or
`push`), so neither side silently wins. See [ADR 0033](adr/0033-tasks-are-local-issues.md).

## Projects: repositories and the environments that belong to them

A **Project** is the grouping a person creates. It owns repositories, adopts
environments, carries the board and — unlike an environment — does not
disappear when nothing is running. That is why it is persisted rather than
derived.

```
Project  "Meu Produto"
├── repositories   api  (local clone, bound to acme/produto-api) · web (acme/produto-web)
└── environments   produto            (path)
                   produto-issue182   (repo-match)
```

A repository belongs to exactly one Project, and a monorepo is one
repository in one Project. `role` is free text with a documented vocabulary —
`api`, `web`, `mobile`, `services`, `infra`, `docs`, `other` — so adding one
later is not a migration. A repository exists without GitHub: a path under
Projects Home, or a remote, is enough. Binding it to a GitHub repository the
App was granted is what makes issues, pull-request state and the write-back
available for it.

### How an environment is adopted, and why

In order, first match wins:

| Source | Meaning |
|---|---|
| `manual` | You linked them in the panel. Always wins |
| `label` | The environment carries `portta.project: <slug>`. The project declared it, per ADR 0001 |
| `repo-match` | The environment's remote matches a repository this Project owns — applied **only when exactly one Project owns that coordinate** |
| `path` | The environment's working directory sits under the Project's directory, or under one of its repositories, and no other Project claims it |

The source is stored and shown, so the panel says *"adopted because it carries
`portta.project: meu-produto`"* rather than presenting a mapping with no
explanation. An ambiguous match adopts nothing and leaves the choice to you:
an automatic adoption that is wrong is worse than none.

An environment belongs to at most one Project; a Project may have any number,
including none.

### What the API keeps separate

`GET /api/projects` lists the product (the grouping). `GET /api/environments`
lists Compose stacks observed on this host.

`DELETE /api/projects/:slug` removes **the grouping and what only Portta
holds about it** — its repositories, tasks, sessions and activity rows: no
container is stopped, no volume is removed, no environment is changed, and no
repository is unlinked from GitHub. The response says so, because it is the
endpoint most likely to be misread.

Every Project endpoint needs the panel's database and answers `503` with a
hint when it is unavailable; writes are refused in read-only mode.

## Project, environment, repository

A **project** is a grouping a person creates. An **environment** is one
Compose project on this host (`COMPOSE_PROJECT_NAME`). A **repository**
is a GitHub repository bound to a project. Today's `projects` table is
the environment; renaming it is part of building the new project entity.

The Compose label `portta.project` remains a hint for grouping
worktrees. It does not silently create a Portta project.

## Default posture

- No App configured: the panel behaves as it does today.
- App configured: outbound calls to `api.github.com` on the network the
  panel already has. No new Docker network.
- Webhooks off by default. A loopback panel cannot receive them, and a
  routed one refuses them until the signed path is exempted (step 7).
  Correctness comes from reconciliation. Webhooks are an optimisation
  for a panel the operator has already published.
- The panel stays refused on the public profile.
- Read-only mode refuses GitHub writes too.

## Setting it up

Ten minutes, at the end of which **Settings → GitHub** shows a connected App, the
installations it has, and the repositories they granted.

None of it needs a public address. The panel calls GitHub; GitHub does not call
the panel, unless you turn webhooks on in step 7, which is optional and which a
loopback panel should skip.

### Before you start

- Portta running, and the panel open.
- A GitHub account you can create an App on.
- A shell on the host. The private key is a **file you put there**, not a value
  the panel will accept — the panel can write its own `.env`, and must not be
  able to write the key that authenticates it.

### 1. Create the App

GitHub → *Settings* → *Developer settings* → *GitHub Apps* → *New GitHub App*.

| Field on the form | What to put | Why |
|---|---|---|
| **GitHub App name** | anything unique, e.g. `portta-<your account>` | GitHub requires it to be unique across all of GitHub |
| **Homepage URL** | anything at all, e.g. your repository | The form demands one; the panel never serves it |
| **Callback URL** | leave it empty | There is no OAuth flow. The panel never receives a redirect |
| **Setup URL** | leave it empty | The panel *discovers* its installations through `GET /app/installations`. It is never told about one |
| **Webhook → Active** | **unticked** | A loopback panel cannot receive a delivery. Step 7 turns this on if yours is already published |
| **Where can this App be installed** | *Only on this account* | The right answer for a development host |

Create the App, and keep the page open: the App id and the private key both come
from it.

### 2. Ask for these permissions, and no others

Under *Repository permissions*. Three of them are what the panel calls today:

| Permission | Access | The call it pays for |
|---|---|---|
| **Metadata** | Read | `GET /installation/repositories`. Mandatory — it is what lists repositories at all |
| **Issues** | Read and write | `GET`, `POST` and `PATCH /repos/{owner}/{repo}/issues`, and `…/issues/{n}/sub_issues`. The board writes back to GitHub |
| **Pull requests** | Read | GitHub's issues endpoint returns pull requests too, and a project page shows the open ones |

Three more belong to the phases after this one. Granting them now costs nothing
and saves a second trip through this form; leaving them out changes nothing you
can see today:

| Permission | Access | What it is for |
|---|---|---|
| **Contents** | Read | Repository shape beyond the default branch, which Metadata already carries |
| **Commit statuses** | Read | Whether checks passed |
| **Checks** | Read | The same, through the Checks API |

**Never `Contents: write`.** The panel does not commit, push, merge or rebase,
and an App that cannot write code cannot be talked into it.

### 3. Install it

*Install App* in the App's sidebar, then install it on your account and choose
between *All repositories* and *Only select repositories*.

That choice is the authorisation boundary. The panel refuses any operation on a
repository the installation did not grant, before it makes the request — so
picking a few repositories now is not a decision you have to get right: widening
it later is *Install App → Configure*, and the next **Sync** picks the change up.

### 4. Put the private key on the host

On the App's settings page, *Private keys* → *Generate a private key*. Your
browser downloads a `.pem`. In your Portta directory, on the host:

```bash
mkdir -p state/github
mv ~/Downloads/your-app.*.private-key.pem state/github/
chmod 600 state/github/*.pem
```

**The directory matters, the filename does not.** Compose mounts
`./state/github` into the panel read-only, and that mount is the only route the
key has into the container (`docker/compose/features/web.yaml`). So the .pem has
to live there, under whatever name you like: keep the one GitHub gave the
download, or rename it to `app.pem`, which is what the panel assumes when you
set nothing. Whichever you choose, step 5 is where you say so.

`chmod 600` is not ceremony. The panel checks the mode as it starts and writes
`… is readable by more than its owner: chmod 600 it`; `portta doctor` fails on
it. The key is read on **every** use rather than cached, so rotating it later is
a `mv` and needs no restart.

### 5. Fill in Settings → GitHub

Open the panel, go to **Settings → GitHub**, and fill the five fields in the
order they appear:

| Field on the screen | Key | What to put | Refused if |
|---|---|---|---|
| **GitHub App** (toggle) | `GITHUB_APP_ENABLED` | on | — |
| **App id** | `GITHUB_APP_ID` | the number at the top of the App's settings page, e.g. `123456` | it is not digits alone |
| **Private key file** | `GITHUB_APP_PRIVATE_KEY_FILE` | `/app/state/github/` and the filename you used in step 4 | it is not under `/app/state/github/` |
| **Webhook secret** | `GITHUB_APP_WEBHOOK_SECRET` | leave it empty for now | — |
| **API base URL** | `GITHUB_API_URL` | `https://api.github.com`, or `https://ghe.example.com/api/v3` on Enterprise Server | it is not a URL |
| **Reconciliation interval** | `GITHUB_SYNC_INTERVAL_MINUTES` | `15`, or `0` on a panel that receives webhooks | it is not a whole number |

Three of those are worth a sentence each.

The **App id** is the App id — not the App name, and not the client id. The
field takes digits and nothing else.

The **private key file** is the path *inside the container*, which is why it
begins `/app/` and not with your home directory. `state/github/` on the host is
`/app/state/github/` there, so a key you dropped in as
`portta.2026-09-02.private-key.pem` is
`/app/state/github/portta.2026-09-02.private-key.pem` here. The field is
refused if it points anywhere else, because nothing else is mounted and the
panel could not open it. Leave it empty and the panel reads
`/app/state/github/app.pem`.

This is the value both diagnostics use: the panel opens the file you name, and
`portta doctor` checks that same file on the host.

The **webhook secret** field shows *not set* or *set*, never a value. No secret
is ever returned by the API, and the `.env` it is written to is mode 600.

Then press **Save**. **Saving writes `.env`. It does not apply it** — which is
what the bar at the top of the page is telling you.

### 6. Apply it, and see that it worked

```bash
./bin/portta up local
portta doctor
```

`up local` recreates the container, and recreating is what makes a changed
`.env` take effect. **`portta web restart` will not do this**: it restarts the
process with the environment it already had, and the App stays invisible. On a
host with `PORTTA_APPLY=true`, the panel's own *Apply and restart* button
performs the same recreate for you.

`doctor` has three checks here, and they are silent when the App is off:

| Check | Passes when |
|---|---|
| `github.app` | the App is enabled and `GITHUB_APP_ID` is set |
| `github.key` | the `.pem` exists, is readable, and is mode `600` or `400` |
| `github.api` | `GITHUB_API_URL` is `https://` |

Now reload **Settings → GitHub**. The card that said *No GitHub App is
configured* shows a **connected** badge, `App <id> · <api url>`, and four
things:

- **Installations** — one badge each. A suspended installation says so, and the
  sync skips it.
- **Repositories** — how many those installations granted. Zero is not a
  failure; it is an installation that granted none. *Install App → Configure*
  is where that is fixed.
- **Rate limit** — what is left of the budget, and when it resets.
- **Last sync** — per scope, with the last error in red when there was one.

Press **Sync**. It is idempotent: two runs leave the same rows, move
`synced_at`, and prune whatever an installation no longer grants.

### 7. Webhooks, if the panel is already published (optional)

Skip this unless the panel has a URL GitHub can reach. Correctness does not
depend on a delivery — reconciliation is the baseline, and a webhook only makes
the panel notice sooner.

**A delivery has no session, and every other panel path requires one.** GitHub
sends no cookie and no Basic credential, so ForwardAuth refuses a delivery
before the panel ever sees it — a `401` with an empty body, and nothing in the
panel's log. One overlay exempts exactly one path from that middleware:

```
docker/compose/features/panel-webhook.yaml
```

It is applied when `GITHUB_APP_ENABLED=true` **and** the panel is routed with
`PORTTA_WEB_EXPOSE=domain`. Both halves matter: `domain` is the only mode that
gives the panel a hostname over HTTPS, and GitHub will not deliver to the plain
HTTP the `panel` entrypoint serves. `portta doctor` warns when the App is on and
the panel is in any other mode, because the symptom otherwise is deliveries
GitHub retries and this host refuses, invisibly.

**Why that exemption is not a hole.** The path is not unauthenticated; it
authenticates differently, and for a machine-to-machine callback more strongly
than a cookie would. GitHub signs the raw body with HMAC-SHA256 under a secret
only it and this host know, and nothing is parsed before that check passes. A
session cookie would be the wrong instrument here — GitHub has no session, and
any scheme that let it in by origin or by address would trust something
forgeable.

It is **not** a general "these URLs are public" list, and Portta does not offer
one. Every other panel path authenticates by session and by nothing else, so
exempting any of them would open an unauthenticated door into an API that can
start, stop and remove containers. The router names one exact path with
`Path(...)`, never a prefix.

Generate a secret and keep it where you can paste it twice:

```bash
openssl rand -hex 32
```

On the App's settings page, under *Webhook*:

| Field | Value |
|---|---|
| **Active** | ticked |
| **Payload URL** | `https://<PORTTA_PANEL_ADVERTISED_HOST>/api/integrations/github/webhook` |
| **Content type** | `application/json` |
| **Secret** | the string you just generated |

Then *Permissions & events* → *Subscribe to events*, and tick exactly these
eight, which are the ones the panel acts on:

*Issues* · *Label* · *Milestone* · *Sub-issues* ·
*Pull request* · *Repository* · *Installation* · *Installation repositories*

*Issue comment* is deliberately **not** among them. Nothing projects a comment,
so a delivery would buy a whole repository reconciliation to refresh one
timestamp — on the event that fires most often in an active repository.

Anything else is acknowledged and dropped. An unhandled event is not an error.

Finally, paste the same secret into **Settings → GitHub → Webhook secret**, save,
and run `./bin/portta up local` again.

The signature is verified over the raw body, in constant time, *before* the body
is parsed as anything meaningful. An invalid one is a `401` that logs the
delivery id and nothing else. A delivery is a signal to re-read, never data to
trust, so nothing GitHub sends widens what the installation granted. Read-only
mode refuses the route outright.

**Where the secret lives.**
[ADR 0018](adr/0018-github-access-lives-in-the-panel.md) prescribed a file with
its path in `.env`, the shape the private key has. Today it is a write-only
`.env` value that the Settings page can set. The credential that *authenticates*
the App is the one that is a file, and that has not moved.

### When it does not work

| What you see | Why | Fix |
|---|---|---|
| *No GitHub App is configured*, after saving | `.env` was written; the container still has the old environment | `./bin/portta up local` |
| Save refuses the App id | it is validated as digits only | use the numeric id, not the App name and not the client id |
| Save refuses the key path | it must be under the one mounted directory | `/app/state/github/<your-file>.pem` |
| doctor: `enabled with no GITHUB_APP_ID` | the toggle is on and the id is empty | copy the id from the App's settings page |
| doctor: `no private key at …` | no `.pem` at the name the field gives, under `state/github/` | correct the filename on one side or the other |
| doctor: `… is outside /app/state/github/` | a path from before the field took effect | move the `.pem` into `state/github/` and re-point the field |
| doctor: `readable by more than its owner` | the key's mode | `chmod 600` the file doctor named |
| doctor: `GITHUB_API_URL is not https` | an API root without TLS | use an `https://` root |
| **unreachable**, *GitHub refused the App credentials* | the id and the key belong to different Apps, or the App was deleted | regenerate the key and re-copy the id |
| **Repositories: 0** after a Sync | the installation granted none | *Install App → Configure* on GitHub |
| An installation marked *(suspended)* | it is suspended on GitHub | unsuspend it; the sync skips suspended ones |
| `503` on an issues page | the panel's PostgreSQL is unavailable, not GitHub | [Persistence](persistence.md) |
| The webhook answers `401` | the secret differs between GitHub and the panel | set the same string on both sides |

The rest of the panel is unaffected by any of these: a GitHub failure never
stops a Docker-backed page from answering. See [Troubleshooting](troubleshooting.md)
and [Security](security.md).

## What is stored, and what is not

Stored, in the panel's own PostgreSQL:

- `github_installations` — which installations exist, for which account, with
  which permissions, and when they were last seen.
- `github_repositories` — the repositories those installations granted. This
  table is the authorisation boundary.
- `github_sync_state` — one row per sync scope, with its last run and its last
  error, so a failure is visible rather than silent.

Every row carries `synced_at`, so the UI can always say how old an answer is —
the same discipline the repository scan already applies.

**Never stored:** the private key, the webhook secret, and any installation
token. A token lives for an hour, is minted on demand, cached in memory with
its expiry and refreshed early. No code path writes one to a row, a log line or
an API response, and a test asserts that.

## No Octokit

The panel image resolves three runtime dependencies, and that smallness is part
of what makes it safe to run on a host that may be reachable over a VPN. What
this needs is an RS256 JWT, a token exchange, Link-header pagination and
rate-limit accounting — about two hundred lines on `node:crypto` and `fetch`.

**Added runtime dependencies: zero.** It is the same trade
[ADR 0011](adr/0011-panel-reads-traefik-writes-one-file.md) made for apr1, and
it is revisited if the surface grows past what is honest to maintain.

## When GitHub is down

The GitHub endpoints answer `503` with a hint, exactly as the database's do.
The projected repository list still answers, because it is read from
PostgreSQL. Every Docker-backed page is unaffected: the panel never blocks a
snapshot on a network call it does not control.

Rate-limit exhaustion is a typed error rather than a 500, and the remaining
budget is on **Settings → GitHub** and in `GET /api/status` so it is visible
before it runs out.

## The API

| Endpoint | What it does |
|---|---|
| `GET /api/integrations/github` | Configuration, reachability, installations, repository count, rate-limit budget, last sync. Never a secret |
| `GET /api/integrations/github/repositories` | The projection, served from the database so it answers while GitHub is down |
| `POST /api/integrations/github/sync` | Idempotent re-sync. Refused in read-only mode |

`GET /api/status` carries the same `github` block, so one request tells an
agent whether the integration is usable.

## Issues, and how they stay in step

Issues are **projected**: GitHub owns them, and the panel keeps a local copy so
the board answers while GitHub is unreachable. Every row carries `syncedAt` and
a staleness flag, exactly as `ProjectGit` carries `collectedAt` and `stale`.

GitHub comments are deliberately not projected wholesale. They are large, they change often, and
a link to GitHub beats a partial mirror — the same reasoning
[ADR 0010](adr/0010-git-collected-on-the-host.md) used for commit lists. There
is no `github_issue_comments` table and a test asserts there is not.

Portta comments are local entities. A user may explicitly publish one as a
copy to the bound GitHub issue. Portta records the returned comment id and URL,
and a failed publication remains retryable without losing the local comment.

### Issues and tasks

A **Task** is Portta's own unit of work; it exists without GitHub. An issue
on a repository a Project owns becomes a task bound to it — every existing
issue did so in the migration that introduced tasks, and a new one does on
the next reconciliation. The board, `portta tasks` and `portta mcp` all work
on tasks; `owner/repo#number` still addresses a bound one.

A write to a bound task is persisted in Portta first and then pushed. When the
App is unavailable the local write succeeds and the binding is marked
`pending` or `error` until `POST /api/tasks/:ref/github/sync` retries it. A remote
change that lands on a pending local edit is a `conflict`, kept and shown
with both sides; `sync` with `resolve: local | remote` settles it. Comments,
parent, agent, type, service, due date and draft stay local; a draft is
not published until it has a real title. See [Tasks](tasks.md) and
[ADR 0032](adr/0032-portta-development-model.md).

### Status and priority: fields where they exist, labels where they do not

Not every account has GitHub's native issue types and project fields, so status
and priority are read through one abstraction with two implementations. A
native field wins where the repository has one; otherwise a documented label
convention decides:

| Status | Label |
|---|---|
| Backlog | `status:backlog` |
| Ready | `status:ready` |
| In Progress | `status:in-progress` |
| Review | `status:review` |
| Blocked | `status:blocked` |
| Done | `status:done` |

| Priority | Label |
|---|---|
| Low | `priority:low` |
| Medium | `priority:medium` |
| High | `priority:high` |
| Urgent | `priority:urgent` |

No caller knows which mechanism was used — but **every response says which**,
in `metadataSource`, because it changes what a write does. Setting a status
through labels means adding one label and removing another, and that shows in
the issue's timeline. The panel marks a label-derived status so nobody is
surprised by it.

Only the dimension being changed is cleared, so setting a priority never
silently drops a status.

#### What this does not read: GitHub Projects v2

`metadataSource` is `fields`, `labels` or `none`. Projects v2 fields are
**GraphQL-only**, and Portta has no GraphQL client, so a repository whose board
lives in a Project is invisible here — and worse, Portta's `status:*` label
writes will not move its cards, which is exactly the second source of truth
[ADR 0018](adr/0018-github-access-lives-in-the-panel.md) exists to forbid.

The seam for it is deliberate: `project` would be a fourth `MetadataSource`,
added *only when a real repository demands it*, together with the GraphQL client
it needs. Recorded as an extension point in ADR 0018's 2026-09-02 amendment, and
not a plan. Sub-issues and issue types are REST, and already in use.

### Three sync paths

| Path | When | How |
|---|---|---|
| **Initial** | A repository is newly authorised | Page through its issues, project them, then resolve sub-issue links in a second pass so a child seen before its parent is not lost |
| **Reconciliation** | On demand, and every `GITHUB_SYNC_INTERVAL_MINUTES` (default 15; `0` turns the timer off) | Ask only for issues updated since the stored cursor. Bounded per run; rate-limit pressure ends the run rather than failing it, and the next run resumes from the cursor. A tick that arrives while the previous pass is still running is skipped |
| **Webhook** | A delivery arrives | A signal to re-read, never data to trust |

`POST /api/integrations/github/sync` runs the repository sync and a
reconciliation pass: one button, one meaning. The timer calls the same
`reconcile`, so pressing the button is asking for the next pass now rather than
for something different.

The timer is what makes a **loopback panel** correct rather than merely
possible: it cannot receive a webhook delivery, so without it the projection is
only as fresh as the last time somebody pressed Sync. Turn it off with
`GITHUB_SYNC_INTERVAL_MINUTES=0` on a panel that does receive deliveries, where
it would otherwise do the same work twice.

### The webhook, and the hole it is allowed to make

The panel refuses every unsafe method without a same-origin `Origin` header.
GitHub sends none, so `POST /api/integrations/github/webhook` is exempt from
that guard — **narrowly, by exact path, and only because an HMAC signature over
the raw body replaces it**.

The signature is verified *before* the body is parsed as anything meaningful. An
invalid one is a `401` that logs the delivery id and nothing else. Read-only
mode still refuses the route, and a delivery for a repository the installation
never granted changes nothing: the projection is the boundary, and deliveries do
not widen it.

Handled events: `issues`, `label`, `milestone`, `sub_issues`, `pull_request`,
`repository`, `installation`, `installation_repositories`. Anything else —
including `issue_comment` — is acknowledged and dropped, and an unhandled event
is not an error.

Webhooks stay optional. A loopback panel cannot receive them, and correctness
comes from reconciliation — which now runs on a timer as well as on demand, so
"correctness comes from reconciliation" is a statement about what the panel does
rather than about what it could do. They are an optimisation for a panel you
have already published.

### Sub-issues

Sub-issue links come from GitHub's own API and are stored as a graph that
cannot cycle: the database refuses `a → a`, and a longer path is refused by
walking the graph before the row is written. A link whose parent is in a
repository the installation did not grant is dropped rather than dangling, so
the tree the UI renders always terminates.

### Writes go through GitHub

`PATCH /api/issues/:id` writes to GitHub and then updates the projection **from
what GitHub returned** — never from what was requested. The panel never shows an
issue GitHub did not confirm. It is refused in read-only mode, refused when no
App is configured, and refused for a repository outside the installation.

### What a status change actually does

| Provider | Moving a card to *Done* |
|---|---|
| Native fields | Sets the field. Nothing appears in the issue's timeline |
| Labels | Adds `status:done` and removes the previous `status:` label. **Both show in the timeline** |

The panel marks a label-derived status so the difference is visible before you
move anything, and only the dimension being changed is cleared: setting a
priority never silently drops a status.

### Pull requests: one source, stated

The host `gh` scan and the App can both report open pull requests. **When the
App is configured and the repository is authorised, the App wins**; otherwise
the scan's `forge` block stands exactly as it does today. A panel with no App
sees `GET /api/projects/:project/git` behave precisely as before.

## The issue and the environment it is worked in

This is the join the rest of the sequence exists for. GitHub knows `#182` is
*In Progress* on branch `fix/182-tcp-proxy`. Only Portta knows that
branch is running as `base-empresarial-issue182`, with `web` and `api` on
`web.issue-182.localhost`, and what its logs say.

```text
#182 Proxy TCP perde conexão
Bug · Priority: High · Status: In Progress
Branch: fix/182-tcp-proxy · Environment: base-empresarial-issue182 (running)
web.issue-182.localhost   api.issue-182.localhost
```

**Linking writes one row.** It never starts, stops, creates or removes
anything.

### Inferred, then corrected, with the reason recorded

In order, first match wins:

| Source | Meaning |
|---|---|
| `manual` | You linked them in the panel. Always wins |
| `label` | The environment declares `portta.issue` as `owner/name#123`, or `#123` when the repository is unambiguous |
| `branch` | The branch matches `(feat\|fix\|chore\|…)/<number>-…`, `issue-<number>` or `<number>-…`, and the repository coordinate resolves |
| `namespace` | The Compose project or worktree ends in `issue<number>`, which is what `portta namespace` produces |

Each rule is a pure function over data the panel already has — no Docker call,
no GitHub call — so the UI can say *"linked because this environment is on
branch `fix/182-tcp-proxy`"* rather than presenting a mysterious association. A
coordinate that matches two projected issues links nothing and offers the
choice.

One issue may have several environments; an environment belongs to at most one
issue.

### Where it shows

- **On the issue**, an Environments section: each linked environment with its
  running count, its branch, its endpoints and a link straight into the project
  page's Logs tab. A linked environment that is not running says how to start it
  rather than showing an error — the panel never starts one for you.
- **On the environment**, a compact issue block on the project page's Overview
  tab: repository, number, title, type, priority, status, the reason for the
  link, and links to GitHub and to the panel.

`GET /api/projects/:project` gains a nullable `issue` block, so nothing that
read it before breaks. `GET /api/issues/:id` gains `environments`, and
`PUT /api/issues/:id/environments` is the manual link.

### What is deliberately not built

There is no `agent_runs` table. Nothing would write to it, and this project
persists decisions rather than speculation. Adding one later is
`CREATE TABLE agent_runs (… issue_id, project_id …)` and no change to anything
above; `issue_environments.worktree_path` is reserved for the same reason and is
null today.
