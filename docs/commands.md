# Command reference

`dev-gateway --help` is the authoritative compact list. Every command and
subcommand also accepts `--help`; this page groups the same surface by purpose
and points to the detailed guides.

## Gateway lifecycle and inspection

| Command | Purpose |
|---|---|
| `dev-gateway setup` | Provision or update a checkout idempotently; `--dry-run` prints the plan. |
| `dev-gateway bootstrap` | Check the runtime, create gateway state and the shared network, then run diagnostics. |
| `dev-gateway up [profile]` | Start `local`, `remote-private` or `remote-public`. |
| `dev-gateway down` | Stop gateway components; consumer projects keep running. |
| `dev-gateway restart` | Recreate gateway components without restarting applications. |
| `dev-gateway status` | Print a compact runtime overview. |
| `dev-gateway logs [service]` | Follow gateway component logs. |
| `dev-gateway doctor` | Run deep diagnostics and print suggested fixes. |
| `dev-gateway urls` | List hostnames Traefik currently serves. |
| `dev-gateway inspect` | Print resolved configuration and Compose files. |
| `dev-gateway update` | Pull pinned images and recreate the gateway. |
| `dev-gateway version` | Print the installed version. |

## Web panel and persisted state

| Command | Purpose |
|---|---|
| `dev-gateway web up` | Start the optional administration panel on loopback. |
| `dev-gateway web open` | Open the panel URL. |
| `dev-gateway web status` | Report panel, authentication and exposure state. |
| `dev-gateway web logs` | Follow panel logs. |
| `dev-gateway web down` | Stop the panel while leaving the gateway running. |
| `dev-gateway web disable` | Disable and stop the panel. |
| `dev-gateway db status` | Inspect the panel PostgreSQL and migrations. |
| `dev-gateway db shell` | Open a shell with private database connectivity. |
| `dev-gateway db dump` | Stream a restorable custom-format backup. |
| `dev-gateway db restore` | Restore a dump after explicit confirmation. |

See [Web panel](web-ui.md) and [Persistence](persistence.md).

## Private and TCP services

| Command | Purpose |
|---|---|
| `dev-gateway services` | List every running project service and how it can be reached. |
| `dev-gateway access open` | Open a temporary loopback bridge to a private TCP service. |
| `dev-gateway access list` | List active bridges and expiry. |
| `dev-gateway access close` | Close one gateway-owned bridge. |
| `dev-gateway access gc` | Remove expired or orphaned bridges. |
| `dev-gateway db psql` | Run `psql` inside a project's private network. |
| `dev-gateway db open` | Open a PostgreSQL bridge for a GUI client. |
| `dev-gateway redis cli` | Run `redis-cli` inside a project's private network. |
| `dev-gateway redis open` | Open a Redis bridge for a GUI client. |
| `dev-gateway service publish` | Give a service a persistent private address. |

See [Database access](database-access.md), [TCP access](tcp-access.md), and
[TCP routing](tcp-routing.md).

## Network, exposure and sharing

| Command | Purpose |
|---|---|
| `dev-gateway network status` | Show interfaces, binds, listeners and reachability. |
| `dev-gateway public status` | Report internet exposure, disabled by default. |
| `dev-gateway public enable` | Enable the public wildcard after review and confirmation. |
| `dev-gateway public disable` | Return to private or local exposure. |
| `dev-gateway share list` | List temporary panel-created hostnames. |
| `dev-gateway share revoke` | Revoke one temporary share. |
| `dev-gateway share gc` | Remove expired shares. |
| `dev-gateway dns status` | Show DNS configuration and provider records. |
| `dev-gateway dns check` | Verify the wildcard points at this host. |
| `dev-gateway dns setup` | Plan or apply the wildcard record. |
| `dev-gateway tls status` | Report TLS mode and certificate state. |
| `dev-gateway tls init` | Create a local CA and wildcard certificate. |
| `dev-gateway tls trust` | Print the platform-specific CA trust command. |

## Projects, worktrees and remote hosts

| Command | Purpose |
|---|---|
| `dev-gateway analyze <path>` | Read a project's Compose model without writing. |
| `dev-gateway init <path>` | Generate an adoption overlay after confirmation. |
| `dev-gateway namespace` | Derive a collision-free Compose project name for a worktree. |
| `dev-gateway git scan` | Collect branch, HEAD and dirty state on the host. |
| `dev-gateway git status` | Report collected Git metadata and its age. |
| `dev-gateway remote bootstrap <user@host>` | Prepare and start a remote gateway over SSH. |
| `dev-gateway remote status|doctor|urls <user@host>` | Query a remote gateway. |
| `dev-gateway remote exec <user@host> -- <command>` | Run an explicit remote gateway command. |
| `dev-gateway toolbox build` | Build the pinned operational toolbox. |
| `dev-gateway toolbox run -- <command>` | Run a one-shot tool in its container. |

## Common flags

`--profile <name>` selects a profile for the invocation, `-y` / `--yes`
accepts confirmation prompts, and `--json` provides machine-readable output on
every read command. `--quiet` suppresses progress, `--verbose` adds diagnostics,
and data stays on stdout while warnings and progress stay on stderr. The stable
JSON shapes and exit codes are specified in [the CLI contract](cli.md).

```bash
dev-gateway bootstrap
dev-gateway up local
dev-gateway urls --project demo-a
dev-gateway doctor --json
dev-gateway remote bootstrap deploy@vps --profile remote-private
```
