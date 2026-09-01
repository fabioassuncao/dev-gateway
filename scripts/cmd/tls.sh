#!/usr/bin/env bash
# `portta tls`: optional local HTTPS.
#
# HTTP works with no setup and is the right default for local development.
# Local HTTPS matters when you need a secure context: Secure cookies, service
# workers, WebAuthn, some SameSite behaviour.
#
# Certificate generation runs in the toolbox container. Trusting the CA does
# not: that writes to the operating system's trust store, so it is a privileged
# host action the user performs deliberately, with the exact command printed.

PORTTA_CA_DIR_REL="config/tls"

portta_cmd_tls() {
  local sub="${1:-status}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    status) portta_tls_status "$@" ;;
    init) portta_tls_init "$@" ;;
    trust) portta_tls_trust "$@" ;;
    untrust) portta_tls_untrust "$@" ;;
    -h|--help|help)
      cat >&2 <<'PORTTA_HELP'
portta tls: optional local HTTPS

  tls status     Show the TLS configuration and any local certificate
  tls init       Create a local CA and a wildcard certificate for the domain
  tls trust      Print the command to trust the CA on this machine
  tls untrust    Print the command to remove it again

Local HTTPS is never required. For remote profiles, certificates come from
ACME over DNS-01 instead. See docs/dns-and-tls.md.
PORTTA_HELP
      ;;
    *) err "unknown tls subcommand: $sub"; return 1 ;;
  esac
}

portta_tls_paths() {
  PORTTA_CA_DIR="$PORTTA_ROOT/$PORTTA_CA_DIR_REL"
  PORTTA_CA_KEY="$PORTTA_CA_DIR/portta-ca.key"
  PORTTA_CA_CRT="$PORTTA_CA_DIR/portta-ca.crt"
  PORTTA_LEAF_KEY="$PORTTA_CA_DIR/wildcard.key"
  PORTTA_LEAF_CRT="$PORTTA_CA_DIR/wildcard.crt"
}

portta_tls_status() {
  portta_tls_paths
  portta_resolve_profile "$PORTTA_PROFILE" >/dev/null 2>&1 || true

  printf '%s\n' "$(portta_bold 'TLS')"
  printf '  %-22s %s\n' "enabled" "$(portta_is_true "$TLS_ENABLED" && printf 'yes' || printf 'no')"
  printf '  %-22s %s\n' "mode" "$TLS_MODE"
  printf '  %-22s %s\n' "domain" "$PORTTA_DOMAIN"

  if [ "$TLS_MODE" = "acme" ]; then
    printf '  %-22s %s\n' "acme email" "${ACME_EMAIL:-<unset>}"
    printf '  %-22s %s\n' "acme directory" "$ACME_CA_SERVER"
    printf '  %-22s %s\n' "dns provider" "$ACME_DNS_PROVIDER"
    local store="$PORTTA_STATE_DIR/traefik/acme/acme.json"
    if [ -f "$store" ]; then
      printf '  %-22s %s (%s)\n' "acme store" "present" "$(ls -l "$store" | cut -c1-10)"
      local n
      n=$(portta_jq -r '[.[].Certificates // [] | length] | add // 0' < "$store" 2>/dev/null || printf '?')
      printf '  %-22s %s\n' "certificates issued" "$n"
    else
      printf '  %-22s %s\n' "acme store" "no certificate issued yet"
    fi
    return 0
  fi

  if [ -f "$PORTTA_CA_CRT" ]; then
    printf '  %-22s %s\n' "local CA" "$PORTTA_CA_CRT"
    printf '  %-22s %s\n' "CA expires" "$(portta_openssl_enddate "$PORTTA_CA_CRT")"
  else
    printf '  %-22s %s\n' "local CA" "not created"
    hint "portta tls init"
  fi
  if [ -f "$PORTTA_LEAF_CRT" ]; then
    printf '  %-22s %s\n' "certificate" "$PORTTA_LEAF_CRT"
    printf '  %-22s %s\n' "covers" "$(portta_openssl_sans "$PORTTA_LEAF_CRT")"
    printf '  %-22s %s\n' "expires" "$(portta_openssl_enddate "$PORTTA_LEAF_CRT")"
  fi
}

portta_openssl_enddate() {
  portta_toolbox_stdin openssl x509 -noout -enddate < "$1" 2>/dev/null | sed 's/^notAfter=//' || printf 'unknown'
}

portta_openssl_sans() {
  # `-ext subjectAltName` is not available in LibreSSL, which is what macOS
  # ships as `openssl`; parsing -text works on both that and OpenSSL.
  portta_toolbox_stdin openssl x509 -noout -text < "$1" 2>/dev/null \
    | grep -A1 'Subject Alternative Name' | tail -1 | sed 's/^ *//' \
    || printf 'unknown'
}

# portta_toolbox_stdin <cmd...>: toolbox with stdin attached, no network.
portta_toolbox_stdin() {
  if portta_have openssl && [ "$1" = "openssl" ]; then
    "$@"
  else
    portta_toolbox_ensure --quiet || return 1
    docker run --rm -i --network none "$PORTTA_TOOLBOX_IMAGE" "$@"
  fi
}

portta_tls_init() {
  portta_tls_paths
  portta_require_docker || return 1
  portta_resolve_profile "$PORTTA_PROFILE" || return 1

  local domain="$PORTTA_DOMAIN"
  mkdir -p "$PORTTA_CA_DIR"
  chmod 700 "$PORTTA_CA_DIR"

  if [ -f "$PORTTA_CA_KEY" ]; then
    info "reusing the existing local CA"
  else
    info "creating a local certificate authority"
    # Generated inside the toolbox so the host needs no openssl. The private
    # key never leaves this directory, which is git-ignored.
    portta_toolbox_ensure || return 1
    docker run --rm -v "$PORTTA_CA_DIR:/out" --network none "$PORTTA_TOOLBOX_IMAGE" sh -c '
      set -e
      openssl req -x509 -newkey rsa:4096 -sha256 -days 1825 -nodes \
        -keyout /out/portta-ca.key -out /out/portta-ca.crt \
        -subj "/CN=Portta local CA/O=Portta" \
        -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
        -addext "keyUsage=critical,keyCertSign,cRLSign"
    ' >/dev/null 2>&1 || { err "could not create the CA"; return 1; }
    ok "created $PORTTA_CA_CRT"
  fi

  info "issuing a wildcard certificate for *.$domain"
  portta_toolbox_ensure || return 1
  docker run --rm -v "$PORTTA_CA_DIR:/out" --network none -e "DOMAIN=$domain" "$PORTTA_TOOLBOX_IMAGE" sh -c '
    set -e
    openssl req -newkey rsa:2048 -nodes \
      -keyout /out/wildcard.key -out /tmp/wildcard.csr \
      -subj "/CN=*.$DOMAIN"
    printf "subjectAltName=DNS:*.%s,DNS:%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n" "$DOMAIN" "$DOMAIN" > /tmp/ext
    openssl x509 -req -in /tmp/wildcard.csr -CA /out/portta-ca.crt -CAkey /out/portta-ca.key \
      -CAcreateserial -out /out/wildcard.crt -days 397 -sha256 -extfile /tmp/ext
  ' >/dev/null 2>&1 || { err "could not issue the certificate"; return 1; }

  chmod 600 "$PORTTA_CA_KEY" "$PORTTA_LEAF_KEY" 2>/dev/null || true
  ok "issued $PORTTA_LEAF_CRT for *.$domain"

  # Hand Traefik the certificate through the file provider.
  cat > "$PORTTA_ROOT/config/traefik/dynamic/local-tls.yaml" <<YAML
# Generated by \`portta tls init\`. Safe to delete: re-run the command to
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

  portta_env_set TLS_ENABLED true
  portta_env_set TLS_MODE local

  ok "TLS enabled in .env"
  printf '\n'
  portta_tls_trust
  hint "then: portta up $PORTTA_PROFILE"
}

portta_tls_trust() {
  portta_tls_paths
  [ -f "$PORTTA_CA_CRT" ] || { err "no local CA yet"; hint "portta tls init"; return 1; }

  printf '%s\n' "$(portta_bold 'Trusting the local CA')"
  printf '%s\n\n' "$(portta_dim 'This writes to your operating system trust store, so the gateway will not do it for you. Run the command that matches your system:')"

  case "$(uname -s)" in
    Darwin)
      printf '  sudo security add-trusted-cert -d -r trustRoot \\\n'
      printf '    -k /Library/Keychains/System.keychain "%s"\n' "$PORTTA_CA_CRT"
      ;;
    Linux)
      printf '  sudo cp "%s" /usr/local/share/ca-certificates/portta-ca.crt\n' "$PORTTA_CA_CRT"
      printf '  sudo update-ca-certificates\n'
      ;;
    *)
      printf '  Import %s into your system trust store as a root certificate.\n' "$PORTTA_CA_CRT"
      ;;
  esac

  printf '\n%s\n' "$(portta_dim 'Firefox keeps its own store: Settings -> Privacy & Security -> Certificates -> View Certificates -> Authorities -> Import.')"
  printf '%s\n' "$(portta_dim 'Remove it later with: portta tls untrust')"
}

portta_tls_untrust() {
  portta_tls_paths
  printf '%s\n' "$(portta_bold 'Removing the local CA from the trust store')"
  case "$(uname -s)" in
    Darwin)
      printf '  sudo security delete-certificate -c "Portta local CA" \\\n'
      printf '    /Library/Keychains/System.keychain\n'
      ;;
    Linux)
      printf '  sudo rm -f /usr/local/share/ca-certificates/portta-ca.crt\n'
      printf '  sudo update-ca-certificates --fresh\n'
      ;;
    *)
      printf '  Remove "Portta local CA" from your system trust store.\n'
      ;;
  esac
  printf '\n%s\n' "$(portta_dim 'To delete the key material as well: rm -rf config/tls/')"
}
