# 0022. The base domain is a mode, and a host with no domain gets one from its address

**Status:** Accepted

## Context

Every project hostname Portta serves is derived, never stored:
`<compose-project>-<service>.<base>`. Traefik bakes the base into its default
rule at startup ([ADR 0005](0005-hostname-convention.md)), and three surfaces
re-derive the same name for display — `portta_discover_http` in the shell,
`routesFor` in the shared core, and `urlsFor` in the panel.

The base came from one variable with one default:

```
PORTTA_DOMAIN=localhost
```

overridden only by `PRIVATE_DOMAIN` on `remote-private` and `PUBLIC_DOMAIN` on
`remote-public`. That is correct on a workstation. `.localhost` resolves to
loopback with no DNS server, no `/etc/hosts` line and no configuration at all,
which is most of why the local profile is pleasant to use.

It is wrong on a VPS, and [ADR 0020](0020-installer-and-portta-home.md) made
that the common case. The installer pins the gateway to the `local` profile on
purpose — so that publishing the panel publishes no application — and the
`local` profile pins the domain to `localhost`. A host installed from
`curl … | bash`, with the panel deliberately reachable over the internet,
therefore advertised URLs like:

```
teste.localhost
```

to somebody reading the panel from another country. The name resolves to *their*
loopback. Nothing they can do makes it open.

The only escape was `remote-public`, which requires a domain you own and also
binds Traefik to every interface. So "I want a URL I can click" was coupled to
"expose every routed application to the internet" and "go buy a domain first" —
two decisions the operator had not asked to make, and the first of which
[ADR 0021](0021-panel-access-modes.md) had just finished decoupling for the
panel and left coupled for applications.

### What the free wildcard DNS services do

`sslip.io` and `nip.io` answer for any name embedding an IPv4 address, with no
record to create, no account and no registration:

```
$ dig +short demo-app-web.2-28-24-129.sslip.io
2.28.24.129
```

Both accept a dotted form (`1.2.3.4.sslip.io`) and a dashed one
(`1-2-3-4.sslip.io`), and both resolve arbitrary prefixes above it. Verified for
both services before adopting either.

## Decision

**The base is a mode, not a value.**

| `PORTTA_DOMAIN_MODE` | Base | For |
|---|---|---|
| `local` | `localhost` | a machine you are sitting at |
| `auto` | `<ip-with-dashes>.sslip.io` | a host with a public address and no domain |
| `custom` | `PORTTA_DOMAIN` | a wildcard you own |

`local` remains the default, so an existing installation resolves exactly as it
did. Supporting values are `PORTTA_PUBLIC_IP` (detected once, written to
`.env`) and `PORTTA_AUTO_DOMAIN_PROVIDER` (`sslip.io` by default, `nip.io` the
other accepted value).

### The dashed form, deliberately

`1-2-3-4.sslip.io` keeps the address inside a single DNS label. That leaves
`<project>-<service>` as its own label, so the whole name is one level below the
base — which is what makes `*.1-2-3-4.sslip.io` a wildcard a single certificate
could cover. The dotted form spreads the address over four labels and puts
project hostnames two levels down, where a wildcard does not reach.

### Resolution happens in both implementations, once

`resolveDomain` in `packages/core/src/domain.ts` and `portta_resolve_domain` in
`scripts/lib/common.sh` compute the same base, because the core commands must
run without Node ([ADR 0015](0015-node-on-the-host.md)) and whichever surface
starts the gateway is the one that bakes the base into Traefik's rule.
`tests/unit/profiles.test.sh` compares the two across every mode and every
failure, including an octet out of range — which is how a genuine bug in the
shell validator was found, where an `exit` inside an `awk` rule was overwritten
by `END { exit 0 }` and turned `203.0.113.999` into a hostname.

Everything downstream keeps reading one resolved `PORTTA_DOMAIN`. That is what
makes changing the mode free: hostnames are derived and never persisted, so a
mode change re-labels every project at once, with no project touched, nothing
to migrate and no route to rewrite by hand.

### A failed mode falls back and says why

A mode that cannot be honoured — `auto` with no address, `custom` with no
domain — resolves to `localhost` and records the reason in
`PORTTA_DOMAIN_PROBLEM`, which `status`, `doctor` and the panel report. A
gateway that refuses to start over an unreachable hostname is worse than the
hostname.

### `remote-public` accepts a derived base

Going public no longer requires owning a domain: when `PUBLIC_DOMAIN` is unset
and the mode yields something other than `localhost`, that becomes the public
base. An explicit `PUBLIC_DOMAIN` still wins, and `local` still cannot satisfy
the profile — publishing `*.localhost` to the internet would serve nobody.

### The installer chooses from an answer it already has

Panel access already asks the question this needs: anything but `local` means
"I reach this machine from somewhere else". So a host whose panel is public or
on the tailnet defaults to `auto`, and a machine whose panel is loopback-only
keeps `local`. `--domain-mode` overrides, and an update keeps whatever is
configured.

### A name is not an exposure

This decision governs **what a service is called**, and nothing else. Which
interface Traefik answers on is `PORTTA_BIND_ADDRESS` and `PUBLIC_ENABLED`;
whether a service is routed at all is its own `traefik.enable` label. An auto
domain on the default `local` profile produces names that resolve to the host
and reach a Traefik that is listening on loopback only — correct, and useless
until somebody deliberately enables public access.

Saying that plainly is part of the decision. `doctor` and the panel both report
the combination rather than silently doing one thing when the operator asked
for the other:

```
[warn] project hostnames  *.2-28-24-129.sslip.io points here, but Traefik listens on 127.0.0.1 only
   -> portta public enable   exposes the HTTP services that opted in
```

## Consequences

A VPS installed with `curl … | bash` now hands out hostnames that resolve from
anywhere, and the panel shows the operator exactly what a project will be
called before any project exists.

**`doctor` gained the check that matters.** `dns.wildcard` used to pass on any
answer; a wildcard pointed at a machine that is no longer this one produced
URLs that load somebody else's site, which is worse than a URL that fails. It
now compares the resolved address against this host's and fails on a mismatch.

**Automatic HTTPS is not part of this.** Let's Encrypt can issue for a single
`web.1-2-3-4.sslip.io` over HTTP-01, but Portta's ACME configuration is DNS-01
(the only challenge that can issue a wildcard), and neither service offers an
API for DNS-01. A wildcard certificate for `*.1-2-3-4.sslip.io` is therefore not
obtainable, and per-hostname HTTP-01 would need port 80 open to the internet —
which is the exposure decision this ADR deliberately keeps separate. Auto
domains serve HTTP; `docs/dns-and-tls.md` says so rather than implying
otherwise.

**Three variables where there was one.** `PORTTA_DOMAIN` still exists and still
means what it meant, but it is now read only in `custom` mode, and the other
modes overwrite it. Editing it without switching the mode writes a value
nothing reads, so `portta config set gateway.domain` says so.
