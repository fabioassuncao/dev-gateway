# TypeScript CLI contract

`portta` is the installable, machine-first interface to
the gateway. It exposes the `portta` binary and requires Node 22.12 or
newer. The repository entry point, `./bin/portta`, delegates to it when
Node and the compiled package are present.

Five commands keep a Bash fallback for a bare host: `bootstrap`, `up`, `down`,
`status` and `doctor`. Every other command requires the TypeScript CLI.

### The two entry points offer the same commands

`./bin/portta` hands over to the TypeScript CLI whenever Node 22.12+ and the
compiled package are present, which is every host the installer touched. A
command the Bash dispatcher names and the TypeScript CLI does not is therefore
unreachable, not a fallback — `tunnel`, `backup`, `restore` and `repair` were
exactly that for one release. `tests/unit/cli.test.sh` fails when the two
surfaces disagree.

`toolbox` is the one command still implemented in shell and reached through a
passthrough: `scripts/lib/toolbox.sh` is the `docker run` wrapper the zero-Node
path needs. A passthrough is transparent — it inherits the terminal, so prompts,
streaming and Ctrl-C work; it forwards `--help` to the implementation rather
than answering with a stub; and it reports the implementation's exit code
unchanged. See [shell scripts](scripts.md) and
[ADR 0029](adr/0029-shell-only-for-bootstrap.md).

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
| `project list` (`environment` is an alias) | Global flags only |
| `project show <name>` | Global flags only |
| `project start\|stop\|restart <name>` | Dependency order; nothing is removed. |
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
arguments directly to the selected client. `db status|migrate|shell|dump|restore`
operate on the panel's private PostgreSQL. `migrate` asks the running panel
to apply pending SQL and needs no flags. Restore needs `--yes` and accepts a
file or stdin.

### Panel, network and integrations

| Command | Command-specific flags |
|---|---|
| `web up`, `web dev` | `--expose local|vpn`, `--port`, `--read-only`, `--writable` |
| `web down|disable|restart|status|open|build` | Global flags only. |
| `web logs [service]` | `web`, `web-ui`, `web-socket-proxy` or `db`. |
| `web auth status|clear|apply` | Global flags only. |
| `web auth set` | `--user`, `--password-stdin`; generated passwords are shown once and only a scrypt hash is stored in the private auth store. |
| `auth protect <host>` | `--user`, `--password-stdin`, `--project`, `--service`; creates or rotates a protected-host record. |
| `auth status [host]` | Read-only; never returns credential hashes. |
| `auth unprotect <host>` | Removes the record; the consumer project's middleware label is unchanged. |
| `network status` | `--public-ip` explicitly permits one external lookup. |
| `public status|enable|disable` | Enable needs confirmation; TCP services are never published. |
| `dns check|status` | Read-only. |
| `dns setup` | `--target <ip>`, `--dry-run`; Cloudflare needs a scoped token. |
| `git scan` | `--project`, `--with-prs`, `--forge-ttl <seconds>` |
| `git status`, `git clear` | Inspect or remove only `state/git/*.json`. |
| `host collect` | Write one host and project metrics snapshot into `state/metrics/current.json`. |
| `host watch` | Start the detached collector, or run it in the foreground with `--loop`. |
| `host status` | Whether the collector is running, and how old the last snapshot is. |
| `share list`, `share revoke <id>`, `share gc` | Shares can only be created in the panel. |
| `tls status|init` | `init` runs OpenSSL in the toolbox container and enables TLS in `.env`. |
| `tls trust|untrust` | Print the privileged command for this operating system; never run it. |
| `remote bootstrap <target>` | `--profile`, `--dir`, `--repo`, `--branch`, `--install-docker`, `--dry-run`. Never copies a secret, never overwrites a remote `.env`. |
| `remote status|doctor|urls <target>` | Read-only, over SSH. `--json` is forwarded. |
| `remote exec <target> -- <cmd>` | Runs the command there with the terminal attached. |
| `remote access open <target>` | `--project`, `--service`, `--port`, `--local-port`, `--dir`. Leaves an SSH tunnel running after the command exits. |
| `remote access list|close` | `close` takes an id or `--all`; the remote bridge is left for the remote host to close. |
| `toolbox ...` | Passthrough to the one-shot Docker wrapper. |
| `mcp` | `--url`, `--allow-remote`, `--actor`. Serves the task verbs to an agent over stdio; refuses a non-loopback panel URL without the flag, because that is where a credential would be sent. See [MCP](mcp.md). |

Host key verification is never relaxed: `StrictHostKeyChecking` defaults to
`accept-new`, which records a key the first time and still refuses a *changed*
one. `PORTTA_SSH_HOST_KEY_POLICY` can tighten it; nothing in the tree sets it
to `no`, and `tests/unit/audit.test.sh` fails if anything ever does.


### Maintenance and tunnelling

| Command | Command-specific flags |
|---|---|
| `tunnel status|setup|enable|disable|test|logs` | `setup` takes `--zone` and reads the token from `--token-file` or a prompt, never from an argument. |
| `backup` | `-o <file>`, `--no-database`; the archive holds credentials and is written 0600. |
| `restore <file>` | `--force`; refuses to overwrite a live installation without it, and always writes a safety copy. |
| `repair` | `--dry-run`; never deletes data, never touches a volume. |


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
| `db migrate` | `applied[]`, `migrations[]` |
| `tls status` | `enabled`, `mode`, `domain`, `certificate`, `authority`, `acme` |
| `tunnel status` | `state`, `detail`, `hint`, `zone`, `wildcard`, `tunnel`, `connector`, `credential` |
| `tunnel setup` | `zone`, `tunnel`, `origin`, `routes[]`, `dns` (`type`, `name`, `target`, `proxied`) |
| `tunnel test` | `host`, `code`, `ok`, `detail`, `hint` |
| `backup` | `file`, `size`, `paths[]`, `database` |
| `repair --dry-run` | `dryRun`, `changes[]` |
| `remote access list` | `tunnels[]` (`id`, `pid`, `target`, `project`, `service`, `remotePort`, `localPort`, `started`, `address`) |

Fields are additive within `0.x`; incompatible changes are called out in the
changelog. Secret values never appear in JSON.
