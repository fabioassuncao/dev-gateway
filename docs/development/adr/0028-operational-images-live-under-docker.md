# 0028. Operational image contexts live under `docker/images/`

**Status:** Accepted

## Context

The Compose matrix and the runnable examples already lived under `docker/`,
but the build contexts for two runtime-owned helper images remained as
root-level `apply/` and `toolbox/` directories. Neither is an application or
an npm workspace: each contains only a Dockerfile and exists solely to produce
an operational image. Their placement made the repository root look as if it
contained two more product subsystems and left Docker assets split across
unrelated levels.

The panel Dockerfile is different. It belongs to the application lifecycle,
has development and runtime stages, and builds `apps/web` and `apps/auth` from
the repository-root workspace context.

## Decision

Runtime-owned, self-contained image contexts live under `docker/images/`:

```text
docker/
├── compose/                 gateway base and overlays
├── images/
│   ├── apply/               settings applier image context
│   └── toolbox/             operational toolbox image context
└── examples/                self-contained demonstration stacks
```

Application Dockerfiles remain colocated with their applications, so the
panel stays at `apps/web/Dockerfile`.

The installer copies `docker/compose/` and `docker/images/`, but not
`docker/examples/`. On upgrade it removes the obsolete root-level image
contexts after the new directory has been copied. No compatibility aliases are
kept; CLI commands remain the stable interface.

## Consequences

The repository root contains product subsystems rather than incidental Docker
build contexts. All Docker-owned runtime assets are discoverable below one
directory without separating an application's image definition from its code.

Manual builds must use `docker/images/apply/` and `docker/images/toolbox/`.
Image names, versions, CLI commands and runtime behavior do not change.
