# 0031. Projects Home, Project, and Environment

**Status:** Accepted, amends [0006](0006-compose-project-name-as-namespace.md),
[0013](0013-what-the-panel-persists.md),
[0016](0016-state-that-could-be-shared.md),
[0018](0018-github-access-lives-in-the-panel.md),
[0020](0020-installer-and-portta-home.md),
[0030](0030-the-panel-and-a-project-lifecycle.md)

## Context

The panel used two words for two different things, and used the more important
word for the less important thing.

`GET /api/projects` answered with what Docker Compose was running on this
host: one `COMPOSE_PROJECT_NAME`, its containers, its URLs. That is an
**Environment** — an executable instance of something the operator is
building. It disappears when the containers do.

A later table named `workspaces` persisted the thing the operator actually
recognises: a product, the repositories that belong to it, the environments
adopted onto this host, and the board of that product's issues. The changelog
called it *"a project that owns several repositories and environments"*. The
UI called it *"the repositories of one product"*. The label that adopts an
environment is `portta.project`. [ADR 0018](0018-github-access-lives-in-the-panel.md)
§6 already named the destination — Project, Environment, Repository — and
left the rename as issue #19.

Keeping `/projects` as the product and `/api/projects` as the Compose stack
would have frozen that collision into the next architecture. The words have to
match the responsibilities now, while the product is still `0.x`.

A third concept was missing: a filesystem root. Discovery walked nowhere and
the operator's code lived wherever `docker compose up` happened to run.
Scanning the whole machine is how a development host becomes unpredictable.
One known directory per installation is the bound.

## Decision

> **The Portta organises the environment. The developer organises the
> project.** One Node has one Projects Home. A Project is what is being
> developed. A Repository is its Git. An Environment is one execution of
> that Project on this Node.

### Canonical vocabulary

| Word | Responsibility |
|---|---|
| **Node / Installation** | The machine running this Portta |
| **Projects Home** | The one filesystem root where managed Projects live |
| **Project** | The product the operator recognises |
| **Repository** | A local Git repository that belongs to a Project |
| **Environment** | An executable instance of a Project on this Node |
| **Service** | A functional unit of an Environment |
| **Container** | One Docker instance |
| **Runtime** | A visual aggregate of environments, services and containers. Not a table |
| **Workspace** | Unused. Reserved only if a later responsibility is genuinely distinct |

Compose is how an Environment is materialised today. The domain word is not
Compose, so a later runtime does not force another rename.

GitHub, GitLab or a self-hosted remote is metadata on a Repository. `git init`
with no remote is a Repository. The GitHub App does not define whether one
exists.

There is no Subproject. Brasil Data Hub is one Project with three
Repositories. FUNAT is one Project, one Repository, one Environment.

### Invariants

1. One Node has one principal Projects Home.
2. A Project has an identity independent of its name, slug, directory, and Home.
3. A managed Project lives at `<PROJECTS_HOME>/<relativePath>`.
4. A Repository is not a Project.
5. An Environment is not permanently a Compose project.
6. A Container belongs to the runtime, not to the filesystem.
7. How the panel is reached does not decide how a Service is exposed
   ([ADR 0021](0021-panel-access-modes.md)).

### Projects Home

`PORTTA_PROJECTS_HOME` is the path. Changing it changes the reference. Files
are never moved.

Defaults, chosen so a gateway backup stays a gateway backup
([ADR 0020](0020-installer-and-portta-home.md)):

- a user install: `$HOME/projects`
- a root / server install: `/srv/projects`
- an operator who wants it next to the gateway may set `<PORTTA_HOME>/projects`

The panel container does not mount Projects Home. Discovery, `realpath`,
`.git`, Compose files and `du` run on the host (CLI, collector, runner). The
panel reads what those already write under `state/`.

Automatic discovery lists only the first level of the Home. Those directories
are **candidates**. A folder is never persisted as a Project by existing.
Confirmed Projects may receive a bounded inner scan. The rest of the disk is
not searched.

A path that is not under the Home after `realpath` is **External /
Unmanaged**. Existing environments outside the Home keep running. They are
not the recommended flow, and they are not backfilled into a Project unless
the association is unambiguous or the operator says so.

### Identity and path

The Project id is stable. When the Project is inside the Home, the stored
location is the **relative** path (`brasil-data-hub`), resolved as
`realpath(PROJECTS_HOME) + relativePath`. An absolute path is not the
identity.

Validation is canonical. `../`, a NUL, a symlink that resolves outside the
Home, a broken link and an unreadable directory are refused or classified
External — never silently treated as managed.

### Attribution

```text
Explicit user association
        ↓
Explicit Portta metadata / labels
        ↓
Known Repository association
        ↓
Projects Home / path convention
        ↓
Automatic discovery
        ↓
Heuristic
```

A heuristic never overrides an explicit association. Two strong sources that
disagree are **Conflict / Ambiguous**, not a silent pick.

A resource is **Project-owned**, **Shared**, **Infrastructure** or
**Unattributed**. Only Project-owned enters a Project rollup in full. Shared
is never counted in full on more than one Project. `portta.managed=true` is
one infrastructure signal, not the only one.

Metrics that cannot be attributed are Unavailable or omitted. Zero means a
valid measurement of zero. Host GPU is a host metric; it is never shown as
Project GPU.

### API

```text
/projects          and  /api/projects        → Project
/environments      and  /api/environments    → Environment
```

`/api/projects` is not an Environment contract. `/workspaces` and
`/api/workspaces` are deprecated aliases of the Project routes, documented
for removal. The CLI follows the same words.

### Persistence

This increment may keep storing Projects in the `workspaces` table and
Environments in the `projects` table. That mismatch is confined to the
persistence layer. Types, services, APIs and new components use the
canonical names. A later, required cleanup renames:

```text
workspaces → projects
projects   → environments
```

`relative_path` on the Project row is a decision. Instantaneous CPU and
memory are not persisted.

### What this record contradicts in earlier ADRs

| Record | Sentence | This record |
|---|---|---|
| ADR 0006 | The gateway keeps no registry of environments | **Stands for discovery of what is running.** A Project is a decision the operator persists; an Environment is still observed from Docker |
| ADR 0006 | `COMPOSE_PROJECT_NAME` is the namespace | **Stands** as the Environment's local identity |
| ADR 0013 | Persist a decision, never an observation | **Stands.** A Project, its relative path and its associations are decisions |
| ADR 0016 | `projects` holds shareable project decisions | **Amended:** that table is Environment storage until the cleanup rename. Shareable decisions belong on the Project |
| ADR 0018 §6 | Project does not exist yet; `projects` is the environment | **Fulfilled.** The grouping shipped as Workspace is the Project |
| ADR 0018 | One repository may belong to several workspaces | **Stands** as optional overlap until a later tightening. An Environment still belongs to at most one Project |
| ADR 0020 | One directory holds everything the host keeps | **Stands for the gateway.** Projects Home is a second, deliberate directory |
| ADR 0030 | Workspace records do not override the working directory | **Stands.** The runner still reads Compose labels, never a path the panel typed |
| ADR 0001 | The gateway does not mount consumer project directories | **Stands.** Projects Home is not bind-mounted into the panel |

## Consequences

`/projects` and `/api/projects` mean the same thing. A new contributor can
read the words without the history.

The cost is a rename across the panel, the CLI and the OpenAPI document, plus
a later schema rename. Deprecated aliases cover one cycle. Carrying
`Workspace` and Compose-`Project` as public words would have cost more, every
time someone added a feature to the wrong noun.
