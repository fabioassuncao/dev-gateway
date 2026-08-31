# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, minor releases may contain breaking changes.

## [Unreleased]

### Added

- Traefik `v3.7.12` gateway reachable on one host port pair, discovering
  services through a read-only, endpoint-filtered Docker socket proxy on an
  `internal` network.
- Hostnames derived automatically from the labels Compose already injects:
  `<compose-project>-<service>.<domain>`.
- `dev-gateway` CLI: `bootstrap`, `up`, `down`, `restart`, `status`, `logs`,
  `doctor`, `urls`, `inspect`, `update`, `version`. `--json` on `status`,
  `doctor` and `urls`.
- `doctor`: runtime, network, component, exposure, DNS, TLS and routing
  diagnostics, including hostname collisions, Traefik service-name collisions
  and uninterpolated `${...}` in labels.
- Two example stacks that both run web on 3000, api on 8000, Postgres on 5432
  and Redis on 6379 with no host port published.
- Lint, unit and end-to-end test suites; CI on Linux including exposure
  regression checks.

### Security

- The Docker socket is never mounted into Traefik.
- `exposedByDefault=false`; the local profile binds to loopback; the dashboard
  is off and, when enabled, is loopback-only and never routed through the
  public entrypoints.

### Known limitations

- Only the `local` profile is implemented and tested so far. The
  `remote-private` and `remote-public` profiles, Tailscale, DNS/TLS automation
  and TCP access bridges are in progress.
- Verified on macOS with OrbStack and on Ubuntu in CI. Docker Desktop is
  expected to work but is not exercised automatically.
