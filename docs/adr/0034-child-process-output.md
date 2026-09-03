# 0034. A child process is never silent for long

**Status:** Accepted

## Context

`runProcess` is the only way the CLI runs anything, and its `stdio` defaulted
to `'pipe'`: the child's output was buffered in memory and, on success,
discarded. Of 109 call sites, 13 asked for `'inherit'` and the rest took that
default — correctly for the majority, which parse `stdout` (`docker info
--format`, `docker inspect`, `git rev-parse`).

The cost fell on the minority. `migrateAuthState` ran `docker compose run
--build portta-auth-migrate` on that default, and a checkout's build overlay
points that service at the full multi-stage panel image: two `npm ci`, a
three-workspace build, a docs render. `portta reset` therefore printed three
lines and sat for ten minutes with nothing on screen and no way to tell a slow
build from a hang. The same default hid a `docker pull`, the first start of a
freshly wiped Postgres volume, and two `docker build -q` calls.

Nothing was wrong with any of those call sites individually. What was wrong is
that forgetting one argument produced total silence, and that the flag meant to
help — `--verbose` — only unlocked one `Output` channel and changed no child's
output at all.

## Decision

**Three modes, named for what they are for.**

- `'pipe'` — captured, not shown. For output this CLI parses. Still the
  default, because most callers read `result.stdout`.
- `'stream'` — captured *and* shown. For work a person is waiting on: a build,
  a pull, a first database start. `execa`'s array targets mean a caller that
  parses `stdout` keeps working when it is switched to `'stream'`.
- `'inherit'` — the child owns the terminal. For prompts, `Ctrl-C`, and
  in-place progress: `db shell`, `logs --follow`, `compose up`.

**A heartbeat under every piped child.** After ten seconds, `runProcess` writes
`wait     still running: <command> (<elapsed>)` to stderr, and repeats every
thirty; after three minutes it adds what to do about it. The label is derived
from the argv already being passed, so there is nothing for a call site to
remember. This is the part that makes the class of bug impossible rather than
fixing one instance of it: forgetting `stdio` now costs ten seconds, not ten
minutes.

**The flags mean what they say.** `--verbose` promotes every `'pipe'` to
`'stream'`; `--quiet` demotes every `'stream'` to `'pipe'` and silences the
heartbeat. Neither touches `'inherit'`, because silencing an explicit
hand-over of the terminal would break a command rather than quieten it.

**`--json` keeps stdout.** A streaming child's stderr is always mirrored; its
stdout is mirrored only when `--json` is off, because `docker pull` writes
layer progress to stdout and that would land inside the document a machine is
reading. BuildKit and Compose write progress to stderr, so a `--json` run still
sees the build. The heartbeat is on stderr for the same reason.

**No timeout on a build.** `execa`'s `timeout` would SIGTERM the `docker`
client while BuildKit carried on in the daemon: it would discard the output and
the exit code without stopping the work. There is also no safe value — a cold
first build on a slow link legitimately exceeds any bound worth setting, and
killing it discards the layer cache already earned. The complaint was "I could
not tell what it was doing", not "it should have given up", and the heartbeat
answers the question that was asked. The one bound that stays is Compose's own
`--wait-timeout` on the panel's health wait, which is a different question and
now fails with a message that says so.

**Phases announce themselves.** `Output.step()` matches `step` in
`scripts/lib/common.sh`, which the shell half of this repository has used since
bootstrap was a shell script. `dev` prints the sequence it is about to run
before the first step of it starts.

## Consequences

A developer watching `make dev` or `make reset` sees the phase, sees the build
that phase is waiting on, and sees BuildKit's own progress inside it. If
something genuinely wedges, the elapsed time says so and they can decide
whether to interrupt — `Ctrl-C` during a build is safe, since BuildKit keeps
its cache.

Choosing the wrong mode is now a quality problem rather than a silence problem:
the worst case is a heartbeat instead of live progress. `packages/cli/src/commands/lifecycle.test.ts`
asserts that no build, pull or `up` on the `dev` path is constructed with its
output swallowed, and the failure prints the offending command line.

The policy lives in a module-level value in `process.ts` set once from argv,
rather than threaded through 109 signatures. That is deliberate and is the one
piece of global state here; the setter is exported so tests control it.
