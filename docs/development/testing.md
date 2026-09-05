# Testing

> Targeted while developing → affected scope when finishing an ordinary task →
> broad regression at integration → full/E2E for release or an explicit reason.

Finishing a feature increment, answering a user, or handing off a small task is
not an integration milestone. Run the smallest test that protects the changed
behavior. Do not repeat passing checks unless relevant code changed afterward.
The agent policy in [AGENTS.md](../../AGENTS.md) governs test selection.

## Choose a test

Every Node workspace accepts a Vitest filename and test-name filter. Prefer a
full relative filename; a substring such as `tasks` can select several files.
Combine a filename with `-t` to avoid importing unrelated files. Check the
executed test count: Vitest can exit successfully when a name matches no cases.

```bash
npm test --workspace=portta-server -- tests/tasks.test.ts -t 'creates, lists, reads and deletes'
npm test --workspace=portta-core -- src/config.test.ts
npm test --workspace=portta-web -- --project ui tests/ui/settings-users.test.tsx
npm test --workspace=portta-web -- --project logic tests/logic/health.test.ts
npm test --workspace=portta-web -- --project server tests/server/compose.test.ts
npm test --workspace=portta-web -- --project docs
bash tests/unit/install.test.sh
bash tests/unit/profiles.test.sh --profile local
bash tests/unit/templates.test.sh --template 01-single-web.yaml
```

Use an existing template filename from `templates/overlays/`. Profile filtering narrows expensive renders and profile parity;
cheap cross-profile safety invariants still run. No argument runs the full matrix.

For a module, give its test directory or several filenames. A workspace suite
is the fallback when no reliable narrower selection exists. Types have the
same scope: `npm run typecheck --workspace=portta-server`, for example.

```bash
npm run test:affected                        # list local changes against HEAD
npm run test:affected -- --base origin/main  # merge-base plus all local changes
npm run test:affected -- --base origin/main --run
```

The selector shows the changed files, commands, reasons, recommendations and
unmapped paths. It includes staged, unstaged, untracked, renamed and removed
files. `--run` refuses a plan with gaps before executing anything. Source files
without an exact test fall back to their workspace; shared packages select
transitive workspace consumers. Configuration and unknown files require an
explicit integration decision. Browser and gateway scenarios are recommendations,
never silently started by diff selection. Reviewing a recommendation is still
necessary: a passing selected scope is not a release certificate.

The selector is deliberately conservative. It does not claim that an import
graph covers SQL, shell sourcing, dynamically imported files, or documentation
read from disk. No remote cache or external monorepo task system is required.

## Layers and commands

| Layer | Trigger | Command |
| --- | --- | --- |
| Development | A coherent small change | Filename/case commands above |
| Affected | Several related modules or a changed shared boundary | Review `test:affected`, then `--run` or explicit suites |
| Integration | PR/meaningful merge milestone | `npm run test:integration` |
| E2E | Changed real system interaction | `npm run test:e2e -- --suite lifecycle` or `--spec roles.spec.ts` |
| Release | Candidate before publishing | `npm run test:release` |

Integration runs static lint (including Compose), shell suites, tooling tests,
all workspace tests, scoped typechecks, OpenAPI and schema drift checks. It
builds core and CLI first so shell parity/smoke uses this checkout's compiled
entrypoint. It does not rebuild the panel or start lifecycle containers.
Some host-observation assertions are conditional; their skips are recorded.
Required static tools (including cloudflared for connector parsing), Node dependencies and selected browser prerequisites
must be present. A name-filtered Vitest execution with zero cases fails in the
orchestrated commands.

`tests/run.sh` remains a compatibility shim requiring Node 22.12+. No arguments
mean integration with an explicit notice. `--fast` is deprecated and has the
same broad scope. `--unit` retains shell + workspaces + types + OpenAPI and now
also schema drift checks. `--lint` runs static checks only; `--e2e` runs only
E2E; `--all` aliases release. Extra/unknown arguments are errors.

`node tests/run.mjs --compose --profile local` and `--compose --template FILE.yaml`
select Compose checks. Use one selector at a time. `just test` still means broad
integration; use the npm filename commands for routine work.

Every orchestrated stage records wall-clock, status, command, skips and a log in
`test-results/<run>/`. Successful stages print a short summary; failed stages
print their diagnostics once. Browser JSON and failure traces live in
`apps/web/test-results/`. CI uploads these artifacts.

## Change-to-test matrix

The minimum is the directly related case/file, not every example in a row.
Widen only for an actual consumer, contract or risk. Integration below applies
to code/configuration PRs; documentation-only PRs check links. A release runs the
complete release gate once, rather than repeating it for each category.

| Change | Minimum | Widen when affected | Real-system check before merge when applicable |
| --- | --- | --- | --- |
| React component | UI file | Consumers, web types | Related browser interaction |
| Copy or colors | Review | Existing visual assertion | None automatically |
| Width/layout | Relevant UI behavior | Affected containers/layouts | `viewports` when layout changed |
| API | Route case | Contract, service, authorization; OpenAPI if it can change | HTTP dispatcher/browser boundary |
| Service | Rule case | Routes and callers | External integration changed |
| Repository | PGlite query/write case | Service caller | PostgreSQL driver-specific behavior |
| Schema | Constraint/cascade test + `db:check` | Repositories | PostgreSQL behavior if different |
| Migration | Fresh migration/idempotence/data preservation + `db:check` | Repositories | Upgrade against PostgreSQL |
| Contract | Schema test + OpenAPI if affected | Typed consumers and route | External API flow |
| Shared core | Core file | Consumers of the changed export | Parity/routing if changed |
| CLI | Command test | CLI build + entrypoint smoke if packaging changed | Relevant command scenario |
| Shell | Subject suite + shellcheck | TypeScript parity | Relevant gateway scenario |
| Installer | Install/maintenance fixture | Audit, upgrade/refusal cases | Disposable install/lifecycle |
| Compose | Affected profile/template | Consumers and matrix | Affected live services |
| Traefik/TCP/TLS | Routing derivation/refusal | Compose and discovery | TCP/TLS with distinct databases |
| Authentication | Auth-core/ForwardAuth case | API security/principal/scope | auth/roles/settings as affected |
| Security | Changed refusal/boundary | All callers of the policy | Corresponding attack/session path |
| Documentation | Links | Docs collector if behavior changed | None automatically |
| Build/packaging | Owning build and entrypoint smoke | Types, consumers | Runtime image as affected |
| Monorepo structure | Boundaries and affected compilation | Transitive consumers | Integration, broader if impact is unclear |

## What the tests protect

Keep tests for business rules, refusals, exit codes, authorization boundaries,
secret handling, data-loss paths and previous bugs. The role matrix, API origin
and scope guards, and browser session tests protect different boundaries. An
Engine API fake does not replace the Docker-backed panel scenario. Bash and
TypeScript implementations both ship and still need parity checks.

Prefer assertions on observable arguments/results to source strings, labels or
class names. Do not remove a security assertion until another test demonstrably
protects the same failure mode. Don't use a browser or database just to test a
pure function; don't replace real constraints/transactions with permissive mocks.
Drive polling timers with fake timers where the timer is the subject. Do not
replace real socket or protocol behavior with artificial clocks.

The panel has four Vitest projects: `logic` (pure Node derivations), `ui`
(jsdom/components), `server` (Node dispatcher), and `docs` (Node collection).
The pools, worker defaults and per-file isolation remain unchanged. Do not turn
on `isolate: false` or concurrent cases over mutable fixtures merely to improve
a benchmark. Compare a representative sample before changing workers.

## PostgreSQL and PGlite

`createTestDb()` creates an independent PostgreSQL/WASM instance on every call.
It lazily caches only an immutable, unseeded image produced by the real
migrations, in the current test module. The template client is closed after
export. No persistent snapshot cache can outlive a schema/version change.

```ts
const { db, close } = await createTestDb()
// migration tests must execute SQL directly, without restoring the image
const fresh = await createTestDb({ fresh: true })
```

Always close instances. Schema tests retain real constraints, foreign keys,
transactions and sequences. Migration tests explicitly use fresh instances.
Snapshots contain no shared mutable rows. `seededDatabase()` adds the Project,
repository and environments needed by service tests. Avoid redundant seeds.

`db:check` copies schema/config/migrations to a temporary package, runs the
actual generator there, compares SQL and metadata, and removes the temporary
package even on failure. It never edits the checkout's journal or snapshots.

## E2E ownership, selection and CI

Gateway scripts refuse direct execution on a shared daemon. The launcher builds
a disposable host with its own Docker daemon, copies source (without local
credentials/state), and runs selected scenarios there. No host Docker socket or
host checkout is mounted. Cleanup verifies ownership and removes only that host
and its anonymous data volume. This requires Docker support for privileged
nested containers; failures are reported, never converted to skips.

Browser specs each own a fresh PostgreSQL, a loopback access bridge, an Engine
API fake and a panel. PostgreSQL publishes no host port. Resource names include
a random invocation identity; teardown checks labels. The browser never reuses
a pre-existing server. Every invocation builds dependencies and the panel once
before workers start. Concurrent E2E builds are refused by a lock.

Roles/settings fixtures create their own owner. Auth bootstrap stays a real UI
scenario, and its wrong-password test also works alone. Retries get fresh worker
resources. Native Playwright filters still work:

```bash
npm run test:e2e --workspace=portta-web -- roles.spec.ts
npm run test:e2e --workspace=portta-web -- auth.spec.ts -g 'password that is wrong'
```

The manual screenshots/viewports tools use the same owned resources. Viewports
remain a deliberate layout check, not a prerequisite for every frontend change.

GitHub Actions validates code PRs with integration and chooses relevant E2E
families for auth, routing, lifecycle and harness changes. Pure component changes
do not automatically run browsers. Tags run all E2E families. Publication depends
on the reusable validation job; failed prerequisites/tests prevent publication.
No schedule, sharding or remote result cache is introduced.

## Measured costs

Audit baseline on 2026-09-05: macOS arm64, 11 available CPUs, 18 GB, Node 22.22.1,
Vitest 4.1.11, installed dependencies and existing build caches. These are single
observations, not universal budgets or cold-install benchmarks.

| Baseline scope | Wall-clock |
| --- | ---: |
| One API case with PGlite | 2.10 s |
| One pure helper file under the former UI project | 0.77 s |
| Core / contracts / CLI / ForwardAuth | 1.34 / 0.46 / 3.80 / 0.65 s |
| DB / auth-core | 13.45 / 12.89 s |
| Web UI / server / docs | 15.93 / 0.40 / 0.57 s |
| Shell suites, sequential | 29.76 s |
| Global types / OpenAPI / static lint | 4.05 / 0.73 / 12.22 s |
| Cached web build | 6.86 s |

The server baseline (57.14 s) included two sandbox socket timeouts and is not a
healthy-suite benchmark. Those two files passed outside the sandbox in 1.12 s.
Do not subtract their individual durations from total wall-clock: workers overlap.

PGlite microprofiling measured about 510 ms for another initialization, 65 ms for
migration, 1 ms for minimal seed and 1 ms for close. Restoring the migrated image
measured 108 ms; exporting it measured 22 ms and about 42 MB. This motivates
sharing an immutable template, not sharing test data. Updated suite and E2E
measurements should come from stage reports, not estimates in this document.

After the setup changes, targeted verification measured DB at 5.17 s (including
an added isolation test), auth-core at 5.15 s, and the six Node logic files at
0.50 s including npm. Five server files (tasks, remembered, overrides, security,
scope) passed together in 9.59 s including npm. The complete integration pass
also passed; its timings overlapped a cold Docker build and are not an isolated
before/after benchmark.

Representative isolated E2E on the same host: the gateway host image took
16.59 s, dependency install 12.83 s, inner web build 31.56 s, gateway image build
125.89 s, and lifecycle including its fixtures/cleanup 165.32 s. These phases
explain why gateway E2E stays outside the interactive loop. Roles passed alone;
bootstrap, wrong password, standalone settings and open-panel scenarios also
passed. In the latter run, per-spec database/bridge readiness was around 2.2 s,
panel startup including migrations/seed 1.3–1.5 s, and database teardown about
0.5 s. Browser cases themselves took 0.28–3.4 s. PostgreSQL migration/seed time
is included in panel startup, not claimed as a separately measured phase.
