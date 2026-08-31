#!/usr/bin/env bash
# Unit tests for scripts/lib/common.sh: no Docker required.
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
. "$DG_ROOT/scripts/lib/common.sh"

describe "dg_slug: hostnames must be DNS-safe"
it "lowercases"                  ; assert_eq "baseempresarial" "$(dg_slug 'BaseEmpresarial')"
it "replaces underscores"        ; assert_eq "base-empresarial" "$(dg_slug 'base_empresarial')"
it "collapses repeated dashes"   ; assert_eq "a-b" "$(dg_slug 'a___b')"
it "trims leading dashes"        ; assert_eq "abc" "$(dg_slug '_abc')"
it "trims trailing dashes"       ; assert_eq "abc" "$(dg_slug 'abc_')"
it "handles dots"                ; assert_eq "a-b-c" "$(dg_slug 'a.b.c')"
it "keeps digits"                ; assert_eq "issue59" "$(dg_slug 'issue59')"
it "survives mixed punctuation"  ; assert_eq "base-empresarial-issue-59" "$(dg_slug 'Base_Empresarial/Issue#59')"

describe "dg_is_true: .env values people actually write"
for v in 1 true TRUE yes Yes on enabled; do
  it "accepts '$v'"; assert_success dg_is_true "$v"
done
for v in 0 false no off "" disabled maybe; do
  it "rejects '$v'"; assert_failure dg_is_true "$v"
done

describe "dg_load_env: parses, never executes"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/.env" <<'ENV'
# a comment
DG_TEST_PLAIN=value
DG_TEST_QUOTED="quoted value"
DG_TEST_SINGLE='single'
DG_TEST_EMPTY=
export DG_TEST_EXPORTED=exported
DG_TEST_EQUALS=a=b=c
not a valid line
DG_TEST_INJECT=`touch /tmp/dg-should-not-exist`
ENV

DG_TEST_PRESET=fromshell
export DG_TEST_PRESET
echo 'DG_TEST_PRESET=fromfile' >> "$tmp/.env"

dg_load_env "$tmp/.env"

it "reads a plain value"            ; assert_eq "value" "${DG_TEST_PLAIN:-}"
it "strips double quotes"           ; assert_eq "quoted value" "${DG_TEST_QUOTED:-}"
it "strips single quotes"           ; assert_eq "single" "${DG_TEST_SINGLE:-}"
it "keeps empty values empty"       ; assert_eq "" "${DG_TEST_EMPTY-unset}"
it "tolerates a leading 'export'"   ; assert_eq "exported" "${DG_TEST_EXPORTED:-}"
it "keeps '=' inside a value"       ; assert_eq "a=b=c" "${DG_TEST_EQUALS:-}"
it "lets the shell environment win" ; assert_eq "fromshell" "${DG_TEST_PRESET:-}"
it "does not execute substitutions" ; assert_failure test -e /tmp/dg-should-not-exist

describe "dg_defaults: an empty .env still yields a working local gateway"
unset DEV_GATEWAY_DOMAIN DEV_GATEWAY_NETWORK DEV_GATEWAY_BIND_ADDRESS DEV_GATEWAY_PROFILE
dg_defaults
it "defaults the domain to localhost"     ; assert_eq "localhost" "$DEV_GATEWAY_DOMAIN"
it "defaults the network name"            ; assert_eq "dev-gateway" "$DEV_GATEWAY_NETWORK"
it "binds to loopback by default"         ; assert_eq "127.0.0.1" "$DEV_GATEWAY_BIND_ADDRESS"
it "defaults to the local profile"        ; assert_eq "local" "$DEV_GATEWAY_PROFILE"

describe "dg_json_escape"
it "escapes double quotes"  ; assert_eq 'say \"hi\"' "$(dg_json_escape 'say "hi"')"
it "escapes backslashes"    ; assert_eq 'a\\\\b' "$(dg_json_escape 'a\\b')"

t_summary
