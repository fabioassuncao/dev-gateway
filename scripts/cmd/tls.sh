#!/usr/bin/env bash
# `dev-gateway tls` — optional local HTTPS.
#
# HTTP works with no setup and is the right default for local development.
# Local HTTPS matters when you need a secure context: Secure cookies, service
# workers, WebAuthn, some SameSite behaviour.
#
# Certificate generation runs in the toolbox container. Trusting the CA does
# not: that writes to the operating system's trust store, so it is a privileged
# host action the user performs deliberately, with the exact command printed.

DG_CA_DIR_REL="config/tls"

dg_cmd_tls() {
  local sub="${1:-status}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    status) dg_tls_status "$@" ;;
    init) dg_tls_init "$@" ;;
    trust) dg_tls_trust "$@" ;;
    untrust) dg_tls_untrust "$@" ;;
    -h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway tls — optional local HTTPS

  tls status     Show the TLS configuration and any local certificate
  tls init       Create a local CA and a wildcard certificate for the domain
  tls trust      Print the command to trust the CA on this machine
  tls untrust    Print the command to remove it again

Local HTTPS is never required. For remote profiles, certificates come from
ACME over DNS-01 instead — see docs/dns-and-tls.md.
DG_HELP
      ;;
    *) err "unknown tls subcommand: $sub"; return 1 ;;
  esac
}

dg_tls_paths() {
  DG_CA_DIR="$DG_ROOT/$DG_CA_DIR_REL"
  DG_CA_KEY="$DG_CA_DIR/dev-gateway-ca.key"
  DG_CA_CRT="$DG_CA_DIR/dev-gateway-ca.crt"
  DG_LEAF_KEY="$DG_CA_DIR/wildcard.key"
  DG_LEAF_CRT="$DG_CA_DIR/wildcard.crt"
}

dg_tls_status() {
  dg_tls_paths
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" >/dev/null 2>&1 || true

  printf '%s\n' "$(dg_bold 'TLS')"
  printf '  %-22s %s\n' "enabled" "$(dg_is_true "$TLS_ENABLED" && printf 'yes' || printf 'no')"
  printf '  %-22s %s\n' "mode" "$TLS_MODE"
  printf '  %-22s %s\n' "domain" "$DEV_GATEWAY_DOMAIN"

  if [ "$TLS_MODE" = "acme" ]; then
    printf '  %-22s %s\n' "acme email" "${ACME_EMAIL:-<unset>}"
    printf '  %-22s %s\n' "acme directory" "$ACME_CA_SERVER"
    printf '  %-22s %s\n' "dns provider" "$ACME_DNS_PROVIDER"
    local store="$DG_STATE_DIR/traefik/acme/acme.json"
    if [ -f "$store" ]; then
      printf '  %-22s %s (%s)\n' "acme store" "present" "$(ls -l "$store" | cut -c1-10)"
      local n
      n=$(dg_jq -r '[.[].Certificates // [] | length] | add // 0' < "$store" 2>/dev/null || printf '?')
      printf '  %-22s %s\n' "certificates issued" "$n"
    else
      printf '  %-22s %s\n' "acme store" "no certificate issued yet"
    fi
    return 0
  fi

  if [ -f "$DG_CA_CRT" ]; then
    printf '  %-22s %s\n' "local CA" "$DG_CA_CRT"
    printf '  %-22s %s\n' "CA expires" "$(dg_openssl_enddate "$DG_CA_CRT")"
  else
    printf '  %-22s %s\n' "local CA" "not created"
    hint "dev-gateway tls init"
  fi
  if [ -f "$DG_LEAF_CRT" ]; then
    printf '  %-22s %s\n' "certificate" "$DG_LEAF_CRT"
    printf '  %-22s %s\n' "covers" "$(dg_openssl_sans "$DG_LEAF_CRT")"
    printf '  %-22s %s\n' "expires" "$(dg_openssl_enddate "$DG_LEAF_CRT")"
  fi
}

dg_openssl_enddate() {
  dg_toolbox_stdin openssl x509 -noout -enddate < "$1" 2>/dev/null | sed 's/^notAfter=//' || printf 'unknown'
}

dg_openssl_sans() {
  # `-ext subjectAltName` is not available in LibreSSL, which is what macOS
  # ships as `openssl`; parsing -text works on both that and OpenSSL.
  dg_toolbox_stdin openssl x509 -noout -text < "$1" 2>/dev/null \
    | grep -A1 'Subject Alternative Name' | tail -1 | sed 's/^ *//' \
    || printf 'unknown'
}

# dg_toolbox_stdin <cmd...> — toolbox with stdin attached, no network.
dg_toolbox_stdin() {
  if dg_have openssl && [ "$1" = "openssl" ]; then
    "$@"
  else
    dg_toolbox_ensure --quiet || return 1
    docker run --rm -i --network none "$DG_TOOLBOX_IMAGE" "$@"
  fi
}

dg_tls_init() {
  dg_tls_paths
  dg_require_docker || return 1
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" || return 1

  local domain="$DEV_GATEWAY_DOMAIN"
  mkdir -p "$DG_CA_DIR"
  chmod 700 "$DG_CA_DIR"

  if [ -f "$DG_CA_KEY" ]; then
    info "reusing the existing local CA"
  else
    info "creating a local certificate authority"
    # Generated inside the toolbox so the host needs no openssl. The private
    # key never leaves this directory, which is git-ignored.
    dg_toolbox_ensure || return 1
    docker run --rm -v "$DG_CA_DIR:/out" --network none "$DG_TOOLBOX_IMAGE" sh -c '
      set -e
      openssl req -x509 -newkey rsa:4096 -sha256 -days 1825 -nodes \
        -keyout /out/dev-gateway-ca.key -out /out/dev-gateway-ca.crt \
        -subj "/CN=Dev Gateway local CA/O=Dev Gateway" \
        -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
        -addext "keyUsage=critical,keyCertSign,cRLSign"
    ' >/dev/null 2>&1 || { err "could not create the CA"; return 1; }
    ok "created $DG_CA_CRT"
  fi

  info "issuing a wildcard certificate for *.$domain"
  dg_toolbox_ensure || return 1
  docker run --rm -v "$DG_CA_DIR:/out" --network none -e "DOMAIN=$domain" "$DG_TOOLBOX_IMAGE" sh -c '
    set -e
    openssl req -newkey rsa:2048 -nodes \
      -keyout /out/wildcard.key -out /tmp/wildcard.csr \
      -subj "/CN=*.$DOMAIN"
    printf "subjectAltName=DNS:*.%s,DNS:%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n" "$DOMAIN" "$DOMAIN" > /tmp/ext
    openssl x509 -req -in /tmp/wildcard.csr -CA /out/dev-gateway-ca.crt -CAkey /out/dev-gateway-ca.key \
      -CAcreateserial -out /out/wildcard.crt -days 397 -sha256 -extfile /tmp/ext
  ' >/dev/null 2>&1 || { err "could not issue the certificate"; return 1; }

  chmod 600 "$DG_CA_KEY" "$DG_LEAF_KEY" 2>/dev/null || true
  ok "issued $DG_LEAF_CRT for *.$domain"

  # Hand Traefik the certificate through the file provider.
  cat > "$DG_ROOT/config/traefik/dynamic/local-tls.yaml" <<YAML
# Generated by \`dev-gateway tls init\`. Safe to delete: re-run the command to
# recreate it. The certificate and key live in config/tls/, which is git-ignored.
tls:
  stores:
    default:
      defaultCertificate:
        certFile: /etc/traefik/tls/wildcard.crt
        keyFile: /etc/traefik/tls/wildcard.key
  certificates:
    - certFile: /etc/traefik/tls/wildcard.crt
      keyFile: /etc/traefik/tls/wildcard.key
YAML

  dg_env_set TLS_ENABLED true
  dg_env_set TLS_MODE local

  ok "TLS enabled in .env"
  printf '\n'
  dg_tls_trust
  hint "then: dev-gateway up $DEV_GATEWAY_PROFILE"
}

dg_tls_trust() {
  dg_tls_paths
  [ -f "$DG_CA_CRT" ] || { err "no local CA yet"; hint "dev-gateway tls init"; return 1; }

  printf '%s\n' "$(dg_bold 'Trusting the local CA')"
  printf '%s\n\n' "$(dg_dim 'This writes to your operating system trust store, so the gateway will not do it for you. Run the command that matches your system:')"

  case "$(uname -s)" in
    Darwin)
      printf '  sudo security add-trusted-cert -d -r trustRoot \\\n'
      printf '    -k /Library/Keychains/System.keychain "%s"\n' "$DG_CA_CRT"
      ;;
    Linux)
      printf '  sudo cp "%s" /usr/local/share/ca-certificates/dev-gateway-ca.crt\n' "$DG_CA_CRT"
      printf '  sudo update-ca-certificates\n'
      ;;
    *)
      printf '  Import %s into your system trust store as a root certificate.\n' "$DG_CA_CRT"
      ;;
  esac

  printf '\n%s\n' "$(dg_dim 'Firefox keeps its own store: Settings -> Privacy & Security -> Certificates -> View Certificates -> Authorities -> Import.')"
  printf '%s\n' "$(dg_dim 'Remove it later with: dev-gateway tls untrust')"
}

dg_tls_untrust() {
  dg_tls_paths
  printf '%s\n' "$(dg_bold 'Removing the local CA from the trust store')"
  case "$(uname -s)" in
    Darwin)
      printf '  sudo security delete-certificate -c "Dev Gateway local CA" \\\n'
      printf '    /Library/Keychains/System.keychain\n'
      ;;
    Linux)
      printf '  sudo rm -f /usr/local/share/ca-certificates/dev-gateway-ca.crt\n'
      printf '  sudo update-ca-certificates --fresh\n'
      ;;
    *)
      printf '  Remove "Dev Gateway local CA" from your system trust store.\n'
      ;;
  esac
  printf '\n%s\n' "$(dg_dim 'To delete the key material as well: rm -rf config/tls/')"
}
