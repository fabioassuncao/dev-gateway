#!/usr/bin/env bash
# Capability detection: the shape the shell emits, and the verdict the shared
# core reaches from it. No Docker, no network.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"
. "$PORTTA_ROOT/scripts/lib/capabilities.sh"

describe "the JSON the shell writes"

it "escapes a value that would otherwise break the document"
assert_eq '"a\"b"' "$(portta_json_string 'a"b')"

it "escapes a backslash"
assert_eq '"a\\b"' "$(portta_json_string 'a\b')"

it "drops a control character rather than emitting invalid JSON"
assert_eq '"ab"' "$(portta_json_string "$(printf 'a\001b')")"

it "calls an absent value null, not an empty string"
assert_eq 'null' "$(portta_json_string '')"

it "only treats the documented spellings as true"
assert_eq 'true' "$(portta_json_bool true)"
assert_eq 'false' "$(portta_json_bool maybe)"

describe "which addresses count as a LAN"

# A host running Docker has one 172.x gateway per network. Offering
# `web.172-18-0-1.sslip.io` as a LAN endpoint would be noise at best, so the
# interface name is what decides, not the address.
stub_ip() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/ip" <<'STUB'
#!/usr/bin/env bash
cat <<'OUT'
1: eth0    inet 192.168.1.20/24 brd 192.168.1.255 scope global eth0
2: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0
3: br-9f2    inet 172.18.0.1/16 brd 172.18.255.255 scope global br-9f2
4: tailscale0    inet 100.87.243.7/32 scope global tailscale0
5: eth1    inet 10.8.0.4/24 brd 10.8.0.255 scope global eth1
OUT
STUB
  chmod +x "$dir/ip"
}

STUB_DIR=$(mktemp -d)
stub_ip "$STUB_DIR"
ADDRESSES=$(PATH="$STUB_DIR:$PATH" portta_private_addresses | tr '\n' ' ')

it "keeps a real private network"
assert_contains "$ADDRESSES" "192.168.1.20"

it "keeps a second one"
assert_contains "$ADDRESSES" "10.8.0.4"

it "drops the Docker bridge"
assert_not_contains "$ADDRESSES" "172.17.0.1"

it "drops a Compose-created bridge"
assert_not_contains "$ADDRESSES" "172.18.0.1"

it "does not report the tailnet address as a LAN, because it has its own capability"
assert_not_contains "$ADDRESSES" "100.87.243.7"
rm -rf "$STUB_DIR"

describe "a tailnet address is not a public address"

# PORTTA_PUBLIC_IP is "the address the automatic domain encodes", and on a host
# reached only over the tailnet that is deliberately a CGNAT address. Reporting
# it as public would tell the operator the internet can reach a service it
# cannot.
facts_with() {
  ( for kv in "$@"; do export "${kv?}"; done
    portta_defaults
    portta_resolve_domain
    portta_capability_facts_json )
}

it "reports a genuine public address"
assert_contains "$(facts_with PORTTA_PUBLIC_IP=203.0.113.10)" '"publicIpv4":"203.0.113.10"'

it "refuses to call a CGNAT address public"
assert_contains "$(facts_with PORTTA_PUBLIC_IP=100.87.243.7)" '"publicIpv4":null'

it "refuses to call an RFC 1918 address public"
assert_contains "$(facts_with PORTTA_PUBLIC_IP=192.168.1.5)" '"publicIpv4":null'

it "still resolves the domain from it, because that is a different question"
assert_contains "$(facts_with PORTTA_DOMAIN_MODE=auto PORTTA_PUBLIC_IP=100.87.243.7)" \
  '"resolvedDomain":"100-87-243-7.sslip.io"'

it "reports a custom domain only in custom mode"
assert_contains "$(facts_with PORTTA_DOMAIN_MODE=custom PORTTA_DOMAIN=dev.example.test)" \
  '"customDomain":"dev.example.test"'
assert_contains "$(facts_with PORTTA_DOMAIN_MODE=local PORTTA_DOMAIN=dev.example.test)" '"customDomain":null'

describe "the shell's facts and the core's verdict are one contract"

# ADR 0015 again: detection is shell so the gateway runs without Node, and the
# verdicts are TypeScript so the panel and the CLI share them. The two only stay
# in step if the shape does.
if ! command -v node >/dev/null 2>&1 || [ ! -f "$PORTTA_ROOT/packages/core/dist/capabilities.js" ]; then
  it "parity"; skip "node or the built core package is unavailable"
else
  verdict() {
    local json="$1" id="$2"
    printf '%s' "$json" | node --input-type=module -e '
      import { capabilitiesFrom, capabilityById } from "'"$PORTTA_ROOT"'/packages/core/dist/capabilities.js"
      let input = ""
      for await (const chunk of process.stdin) input += chunk
      const found = capabilityById(capabilitiesFrom(JSON.parse(input)), process.argv[1])
      process.stdout.write(found ? found.state : "MISSING")
    ' "$id" 2>&1
  }

  it "the shell emits every field the core declares, and no other"
  MISMATCH=$(facts_with PORTTA_PUBLIC_IP=203.0.113.10 | node --input-type=module -e '
    import { emptyFacts } from "'"$PORTTA_ROOT"'/packages/core/dist/capabilities.js"
    let input = ""
    for await (const chunk of process.stdin) input += chunk
    const parsed = JSON.parse(input)
    const expected = emptyFacts()
    const compare = (a, b, path) => {
      const left = Object.keys(a).sort().join(",")
      const right = Object.keys(b).sort().join(",")
      return left === right ? "" : `${path}: shell has [${left}] core wants [${right}]`
    }
    const problems = [
      compare(parsed, expected, "facts"),
      compare(parsed.tailscale, expected.tailscale, "tailscale"),
      compare(parsed.cloudflare, expected.cloudflare, "cloudflare"),
    ].filter(Boolean)
    process.stdout.write(problems.join(" | "))
  ' 2>&1)
  assert_eq "" "$MISMATCH"

  DETECTED=$(facts_with PORTTA_PUBLIC_IP=203.0.113.10)

  it "a detected public address makes the automatic domain available"
  assert_eq "available" "$(verdict "$DETECTED" auto-domain)"

  it "localhost is always available"
  assert_eq "available" "$(verdict "$DETECTED" localhost)"

  TAILNET_ONLY=$(facts_with PORTTA_DOMAIN_MODE=auto PORTTA_PUBLIC_IP=100.87.243.7)

  it "a tailnet-only host has no public automatic domain"
  assert_eq "unavailable" "$(verdict "$TAILNET_ONLY" auto-domain)"

  it "and no public address either"
  assert_eq "unavailable" "$(verdict "$TAILNET_ONLY" public-ipv4)"
fi

t_summary
