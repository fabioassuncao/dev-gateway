# TypeScript CLI contract

`portta` is the installable, machine-first interface to
the gateway. It exposes the `portta` binary and requires Node 22.12 or
newer. The repository entry point, `./bin/portta`, delegates to it when
Node and the compiled package are present.

Five commands keep a Bash fallback for a bare host: `bootstrap`, `up`, `down`,
`status` and `doctor`. TLS, remote SSH and toolbox operations remain
shell-native drivers. Every other command requires the TypeScript CLI.

## Installation

```bash
npx portta --version
npm install --global portta
portta setup --dry-run
portta setup --yes
```

`setup` requires POSIX, Node 22.12+, npm, Git, network access, Docker Engine
24+ and Compose v2. It never installs system packages, invokes `sudo`, edits a
firewall or `/etc/hosts`, or overwrites an unrelated directory. It clones or
fast-forwards the gateway checkout, creates `.env` only when absent, ensures
gateway-owned directories and the shared network, pulls pinned images, starts
the selected profile and checks that components stayed running. Repeating it
is idempotent; `--dry-run` changes nothing.

## Global flags and streams

| Flag | Contract |
|---|---|
| `--json` | Emit the documented data object on stdout. Progress and warnings stay on stderr. |
| `-y`, `--yes` | Confirm every gated operation non-interactively. `PORTTA_ASSUME_YES` remains a compatibility alias. |
| `--quiet` | Suppress progress; never suppress errors or requested data. |
| `--verbose` | Add diagnostic detail on stderr. |
| `--profile <name>` | Select `local`, `remote-private` or `remote-public`. |
| `-h`, `--help` | Available at the root and every command level. |
| `-V`, `--version` | Available globally, including after a subcommand. |

A command that needs confirmation never prompts when stdin is not a TTY. It
exits 4 and names `--yes` instead. Programs are always executed as an
executable plus an argument array with shell expansion disabled.

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | Success. |
| 1 | The requested operation failed. |
| 2 | Usage error: unknown command, missing argument or invalid flag. |
| 3 | Precondition missing: Docker unavailable, checkout absent or gateway down. |
| 4 | Refused by a safety rule or because confirmation was not supplied. |

## Command tree

### Gateway

| Command | Command-specific flags |
|---|---|
| `setup` | `--dir`, `--repo`, `--branch`, `--profile`, `--dry-run`, `--skip-pull` |
| `bootstrap` | `--skip-pull` |
| `up [profile]` | `--attach` |
| `down`, `restart`, `status`, `doctor`, `inspect`, `update`, `version` | Global flags only |
| `logs [service]` | `--no-follow`, `--tail <lines>` |
| `urls` | `--project <name>` |

### Projects

| Command | Command-specific flags |
|---|---|
| `project list` | Global flags only |
| `project show <name>` | Global flags only |
| `project services` | `--project <name>` |
| `project analyze <path>` | Read-only. |
| `project init <path>` | `--dry-run`, repeatable `--service <name:port>`, `--output`, `--force`; writing needs confirmation. |
| `project namespace` | `--path`, `--base`, `--suffix`, `--no-check` |

`services`, `analyze`, `init` and `namespace` are compatibility aliases for
one minor release.

### Private access

| Command | Command-specific flags |
|---|---|
| `access open` | Required `--project`, `--service`; optional `--port`, `--local-port`, `--ttl`, `--network`, `--bind` |
| `access list` | Global flags only. |
| `access close [id]` | Alternatively `--project` or `--all`. |
| `access inspect <id>`, `access gc` | Global flags only. |
| `service publish` | Required `--private`, `--project`, `--service`; optional `--port`, `--alias`. `--public` is always refused. |
| `service list` | Global flags only. |
| `service unpublish [alias]` | Alternatively `--project`. |

`db open|close|url|psql|mysql` and `redis open|close|cli` are typed
conveniences over the same bridges or one-shot toolbox clients. Client
commands require `--project`, accept `--service` and `--port`, and pass trailing
arguments directly to the selected client. `db status|shell|dump|restore`
operate on the panel's private PostgreSQL; restore needs `--yes` and accepts a
file or stdin.

### Panel, network and integrations

| Command | Command-specific flags |
|---|---|
| `web up`, `web dev` | `--expose local|vpn`, `--port`, `--read-only`, `--writable` |
| `web down|disable|restart|status|open|build` | Global flags only. |
| `web logs [service]` | `web`, `web-ui`, `web-socket-proxy` or `db`. |
| `web auth status|clear|apply` | Global flags only. |
| `web auth set` | `--user`, `--password-stdin`; generated passwords are shown once and only the apr1 hash is stored. |
| `network status` | `--public-ip` explicitly permits one external lookup. |
| `public status|enable|disable` | Enable needs confirmation; TCP services are never published. |
| `dns check|status` | Read-only. |
| `dns setup` | `--target <ip>`, `--dry-run`; Cloudflare needs a scoped token. |
| `git scan` | `--project`, `--with-prs`, `--forge-ttl <seconds>` |
| `git status`, `git clear` | Inspect or remove only `state/git/*.json`. |
| `share list`, `share revoke <id>`, `share gc` | Shares can only be created in the panel. |
| `tls ...`, `remote ...`, `toolbox ...` | Shell-native OpenSSL, SSH and one-shot Docker drivers. |

## JSON shapes

Every read command accepts the global `--json`. Stable top-level fields are:

| Command | Top-level data |
|---|---|
| `status` | `version`, `instance`, `profile`, `domain`, `bindAddress`, `network`, `components`, `projectCount`, `routeCount`, `tls`, `public` |
| `doctor` | `ok`, `instance`, `checks[]` (`id`, `status`, `message`, optional `fix`) |
| `urls` | `instance`, `routes[]`, and the compatibility alias `urls[]` (`project`, `service`, `container`, `hostname`, `url`, `port`, `state`) |
| `inspect` | `profile`, redacted `configuration`, `composeFiles` |
| `project list` | `instance`, `projects[]` (`name`, `state`, `serviceCount`, `urls`) |
| `project show` | `instance`, `name`, `state`, `services`, `urls` |
| `project services` | `instance`, `services[]` |
| `project analyze` | `path`, `compose_file`, `gateway_overlay`, `project`, `domain`, `services`, `findings` |
| `project namespace` | `namespace`, `base`, `suffix` |
| `access list` | `bridges[]` (`id`, `project`, `service`, `target_port`, `local_port`, `kind`, `expires`, `bind`, `network`, `state`) |
| `service list` | `forwarders[]` |
| `web status` | `enabled`, `devMode`, `readOnly`, `expose`, `url`, `panel`, `socketProxy` |
| `web auth status` | `expose`, `mode`, `user`, `hashSet`, `middleware` |
| `network status` | `instance`, `bindAddress`, `publicIp`, `bindings`, `publicBindings` |
| `public status` | `enabled`, `profile`, `domain`, `bindAddress` |
| `dns check` | `domain`, `hostname`, `addresses`, `resolves` |
| `dns status` | `enabled`, `zone`, `domain`, `tokenSet` |
| `git status` | `projects[]`, each with collected metadata plus `ageSeconds` |
| `share list` | `shares[]` |
| `db status` | `state`, `container`, `network` |

Fields are additive within `0.x`; incompatible changes are called out in the
changelog. Secret values never appear in JSON.
