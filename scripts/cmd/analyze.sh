#!/usr/bin/env bash
# `dev-gateway analyze <path>`: read-only report on how a project would adopt
# the gateway.
#
# It reads. It never writes, never starts anything, never touches the project's
# containers or volumes. `dev-gateway init` is the command that writes, and it
# asks first.

# Images whose services belong on the project's private network and nowhere
# else. Matched as substrings against the image reference.
# Tab is IFS whitespace, so `read` collapses empty fields and shifts columns.
# The unit separator does not, which matters because "no published port" is
# exactly the empty field we care about.
DG_FS=$(printf '\037')

DG_DATASTORE_IMAGES="postgres postgis timescale mysql mariadb percona redis valkey keydb mongo memcached elasticsearch opensearch rabbitmq kafka clickhouse cassandra neo4j minio rustfs mailpit mailhog"

# Images that usually terminate HTTP.
DG_HTTP_IMAGES="nginx httpd apache caddy traefik node php python ruby golang openresty haproxy whoami frankenphp"

dg_cmd_analyze() {
  local path="" as_json=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --json) as_json=1 ;;
      -h|--help)
        cat >&2 <<'DG_HELP'
dev-gateway analyze <path>: report on how a project would adopt the gateway

  --json    Machine-readable output

Read-only. Reports the services, published host ports, likely HTTP services,
datastores, container_name usage, conflicts with what is running right now, and
what adopting the gateway would take. It never modifies the project.

`dev-gateway init <path>` writes the overlay this report describes.
DG_HELP
        return 0 ;;
      -*) die "unknown flag: $1" ;;
      *) path="$1" ;;
    esac
    shift
  done

  [ -n "$path" ] || { err "a project path is required"; hint "dev-gateway analyze /path/to/project"; return 1; }
  [ -d "$path" ] || { err "not a directory: $path"; return 1; }

  dg_require_docker || return 1
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" >/dev/null 2>&1 || true

  local abs
  abs=$(cd "$path" && pwd)

  local files
  files=$(dg_analyze_find_compose "$abs")
  if [ -z "$files" ]; then
    err "no Compose file found in $abs"
    hint "looked for compose.yaml, compose.yml, docker-compose.yml, docker-compose.yaml"
    return 1
  fi

  local rendered
  rendered=$(dg_analyze_render "$abs" "$files") || return 1

  if [ "$as_json" = "1" ]; then
    dg_analyze_json "$abs" "$files" "$rendered"
  else
    dg_analyze_human "$abs" "$files" "$rendered"
  fi
}

# dg_analyze_find_compose <dir>: the project's own compose files, most
# canonical first. Gateway overlays are reported separately, not merged.
dg_analyze_find_compose() {
  local dir="$1" f out=""
  for f in compose.yaml compose.yml docker-compose.yml docker-compose.yaml; do
    [ -f "$dir/$f" ] && { out="$f"; break; }
  done
  printf '%s' "$out"
}

dg_analyze_has_overlay() {
  local dir="$1" f
  for f in compose.dev-gateway.yaml compose.dev-gateway.yml; do
    [ -f "$dir/$f" ] && { printf '%s' "$f"; return 0; }
  done
  printf ''
}

# dg_analyze_render <dir> <file>: the resolved model as JSON.
#
# Interpolation is attempted first because it gives real values; a project with
# required variables we cannot supply falls back to --no-interpolate so the
# analysis still works, at the cost of seeing ${VAR} in some fields.
dg_analyze_render() {
  local dir="$1" file="$2" out
  if out=$( cd "$dir" && docker compose -f "$file" config --format json 2>/dev/null ); then
    printf '%s' "$out"
    return 0
  fi
  if out=$( cd "$dir" && docker compose -f "$file" config --format json --no-interpolate 2>/dev/null ); then
    warn "some variables could not be resolved; analysing the uninterpolated file"
    printf '%s' "$out"
    return 0
  fi
  err "could not parse $file"
  hint "cd '$dir' && docker compose -f '$file' config"
  return 1
}

# Service names that usually mean "this is not the thing users browse to".
DG_WORKER_NAMES="worker queue scheduler cron consumer beat migrator migrate init seed setup"
# Service names that usually terminate HTTP.
DG_HTTP_NAMES="web app api frontend backend site www http nginx server ui admin dashboard gateway"

# dg_analyze_classify <image> <service-name>
#
# The image is the strongest signal, but a project that builds its own image
# has none, so the service name is used as a fallback rather than giving up.
dg_analyze_classify() {
  local image="$1" name="${2:-}" lower lname word
  lower=$(printf '%s' "$image" | tr '[:upper:]' '[:lower:]')
  lname=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')

  for word in $DG_DATASTORE_IMAGES; do
    case "$lower" in *"$word"*) printf 'datastore'; return 0 ;; esac
  done
  for word in $DG_HTTP_IMAGES; do
    case "$lower" in *"$word"*) printf 'http'; return 0 ;; esac
  done

  # A worker shares its application image with the web service, so the name is
  # the only thing that tells them apart.
  for word in $DG_WORKER_NAMES; do
    case "$lname" in "$word"|*"-$word"|"$word-"*|*"_$word"|"$word"_*) printf 'worker'; return 0 ;; esac
  done
  for word in $DG_HTTP_NAMES; do
    case "$lname" in "$word"|*"-$word"|"$word-"*|*"_$word"|"$word"_*) printf 'http'; return 0 ;; esac
  done

  printf 'unknown'
}

# dg_analyze_project_name <dir>: what COMPOSE_PROJECT_NAME will actually be,
# following Compose's own precedence.
dg_analyze_project_name() {
  local dir="$1" name=""
  if [ -f "$dir/.env" ]; then
    name=$(grep -E '^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROJECT_NAME=' "$dir/.env" 2>/dev/null \
      | head -1 | sed -e 's/^[^=]*=//' -e 's/^["'"'"']//' -e 's/["'"'"']$//')
  fi
  if [ -n "$name" ]; then printf '%s%s%s' "$name" "$DG_FS" ".env"; return 0; fi
  printf '%s%s%s' "$(dg_slug "$(basename "$dir")")" "$DG_FS" "directory name (implicit)"
}

dg_analyze_human() {
  local dir="$1" file="$2" json="$3"
  local overlay pname psource
  overlay=$(dg_analyze_has_overlay "$dir")
  IFS="$DG_FS" read -r pname psource <<EOF
$(dg_analyze_project_name "$dir")
EOF

  printf '%s\n' "$(dg_bold "Project: $(basename "$dir")")"
  printf '  %-22s %s\n' "path" "$dir"
  printf '  %-22s %s\n' "compose file" "$file"
  printf '  %-22s %s\n' "gateway overlay" "${overlay:-none}"
  printf '  %-22s %s (%s)\n' "project namespace" "$pname" "$psource"

  # ---- services --------------------------------------------------------
  printf '\n%s\n' "$(dg_bold 'Services')"
  printf '  %-16s %-30s %-10s %-10s %s\n' "SERVICE" "IMAGE" "KIND" "HOSTPORTS" "NETWORKS"

  local svc image kind hostports nets
  while IFS="$DG_FS" read -r svc image hostports nets; do
    [ -n "${svc:-}" ] || continue
    kind=$(dg_analyze_classify "$image" "$svc")
    printf '  %-16s %-30s %-10s %-10s %s\n' \
      "$svc" "$(printf '%.30s' "$image")" "$kind" "${hostports:--}" "${nets:-default}"
  done <<EOF
$(printf '%s' "$json" | dg_jq -r '
  .services | to_entries[] |
  [ .key,
    (.value.image // "<built>"),
    ((.value.ports // []) | map(
        (if .published then (.published|tostring) else "" end)
        + (if .published then ":" else "" end)
        + ((.target // "")|tostring)
      ) | join(",")),
    ((.value.networks // {}) | keys | join(","))
  ] | join("\u001f")' 2>/dev/null)
EOF

  # ---- findings --------------------------------------------------------
  local findings=0

  printf '\n%s\n' "$(dg_bold 'Findings')"

  # Published host ports: the actual source of collisions.
  local published
  published=$(printf '%s' "$json" | dg_jq -r '
    .services | to_entries[] | .key as $s |
    (.value.ports // [])[] | select(.published) |
    "\($s)\u001f\(.published)\u001f\(.target)"' 2>/dev/null)

  if [ -n "$published" ]; then
    printf '\n  %s\n' "$(dg_c 33 'Published host ports')"
    printf '  %s\n' "$(dg_dim 'These are what collide between projects. HTTP services do not need them once the gateway routes by hostname; datastores are reached with `dev-gateway access open`.')"
    local s hp cp inuse
    while IFS="$DG_FS" read -r s hp cp; do
      [ -n "${s:-}" ] || continue
      findings=$((findings + 1))
      inuse=$(dg_analyze_port_holder "$hp")
      if [ -n "$inuse" ]; then
        printf '    %-16s %s -> %s  %s\n' "$s" "$hp" "$cp" "$(dg_c 31 "already held by $inuse")"
      else
        printf '    %-16s %s -> %s\n' "$s" "$hp" "$cp"
      fi
    done <<EOF
$published
EOF
  else
    printf '\n  %s\n' "$(dg_c 32 'No published host ports, so nothing can collide.')"
  fi

  # container_name defeats parallel copies.
  local fixed
  fixed=$(printf '%s' "$json" | dg_jq -r '
    .services | to_entries[] | select(.value.container_name) |
    "\(.key)\u001f\(.value.container_name)"' 2>/dev/null)
  if [ -n "$fixed" ]; then
    findings=$((findings + 1))
    printf '\n  %s\n' "$(dg_c 33 'Fixed container names')"
    printf '  %s\n' "$(dg_dim 'A container name is global to the host, so the second copy of this project fails to start. Remove container_name and let Compose derive it from the namespace.')"
    printf '%s\n' "$fixed" | while IFS="$DG_FS" read -r s n; do
      [ -n "${s:-}" ] || continue
      printf '    %-16s container_name: %s\n' "$s" "$n"
    done
  fi

  # Datastores that are published or already on the shared network.
  local ds_published=""
  while IFS="$DG_FS" read -r svc image hostports _nets; do
    [ -n "${svc:-}" ] || continue
    [ -n "${hostports:-}" ] || continue
    [ "$(dg_analyze_classify "$image" "$svc")" = "datastore" ] || continue
    ds_published="$ds_published    $svc ($image) publishes $hostports
"
  done <<EOF
$(printf '%s' "$json" | dg_jq -r '
  .services | to_entries[] |
  [ .key, (.value.image // ""),
    ((.value.ports // []) | map(select(.published) | (.published|tostring)) | join(",")),
    ((.value.networks // {}) | keys | join(","))
  ] | join("\u001f")' 2>/dev/null)
EOF
  if [ -n "$ds_published" ]; then
    findings=$((findings + 1))
    printf '\n  %s\n' "$(dg_c 33 'Datastores published on the host')"
    printf '  %s\n' "$(dg_dim 'Drop these and reach them on demand instead: dev-gateway access open --project <name> --service <service>')"
    printf '%s' "$ds_published"
  fi

  # Namespace collision with something already running.
  if dg_compose_projects | grep -qx "$pname"; then
    findings=$((findings + 1))
    printf '\n  %s\n' "$(dg_c 33 'Namespace already in use')"
    printf '    %s\n' "a Compose project named '$pname' is running on this host"
    printf '    %s\n' "$(dg_dim 'that is fine if it is this project; otherwise set a distinct COMPOSE_PROJECT_NAME')"
  fi

  if [ "$psource" = "directory name (implicit)" ]; then
    findings=$((findings + 1))
    printf '\n  %s\n' "$(dg_c 33 'Namespace is implicit')"
    printf '    %s\n' "COMPOSE_PROJECT_NAME is not set, so Compose uses the directory name"
    printf '    %s\n' "$(dg_dim 'set it explicitly in .env; it is what keeps worktrees apart')"
  fi

  [ "$findings" -gt 0 ] || printf '\n  %s\n' "$(dg_c 32 'Nothing to change.')"

  # ---- plan ------------------------------------------------------------
  printf '\n%s\n' "$(dg_bold 'Adoption plan')"
  if [ -n "$overlay" ]; then
    printf '  %s\n' "This project already has $overlay."
    printf '  %s\n' "Run it with:"
    printf '    cd %s && docker compose -f %s -f %s up -d\n' "$dir" "$file" "$overlay"
  else
    local http_svcs
    http_svcs=$(dg_analyze_http_services "$json")
    if [ -z "$http_svcs" ]; then
      printf '  %s\n' "No service looks like it terminates HTTP, so there may be nothing to route."
      printf '  %s\n' "$(dg_dim 'If that is wrong, pass the service names to `dev-gateway init --service <name>:<port>`.')"
    else
      printf '  %s\n' "Attach these services to the gateway:"
      printf '%s\n' "$http_svcs" | while IFS="$DG_FS" read -r s p; do
        [ -n "${s:-}" ] || continue
        printf '    %-16s port %-6s -> http%s://%s-%s.%s\n' "$s" "$p" \
          "$(dg_is_true "$TLS_ENABLED" && printf 's')" "$(dg_slug "$pname")" "$(dg_slug "$s")" "$DEV_GATEWAY_DOMAIN"
      done
      printf '\n  %s\n' "Generate the overlay (shows a diff and asks before writing):"
      printf '    dev-gateway init %s\n' "$dir"
    fi
  fi

  printf '\n%s\n' "$(dg_dim 'Nothing in this project was modified. See docs/adopting-projects.md.')"
}

# dg_analyze_http_services <json>: service<TAB>port for services that look
# like they serve HTTP. Prefers a declared port; falls back to the first
# published or exposed one.
dg_analyze_http_services() {
  local json="$1" svc image hostports target
  while IFS="$DG_FS" read -r svc image hostports target; do
    [ -n "${svc:-}" ] || continue
    case "$(dg_analyze_classify "$image" "$svc")" in
      datastore|worker) continue ;;
    esac
    local port="${target:-}"
    [ -n "$port" ] || port="${hostports:-}"
    [ -n "$port" ] || continue
    printf '%s%s%s\n' "$svc" "$DG_FS" "$port"
  done <<EOF
$(printf '%s' "$json" | dg_jq -r '
  .services | to_entries[] |
  [ .key, (.value.image // ""),
    ((.value.ports // []) | map(select(.published) | (.published|tostring)) | first // ""),
    (((.value.ports // []) | map(.target) | first) // ((.value.expose // []) | first) // "" | tostring)
  ] | join("\u001f")' 2>/dev/null)
EOF
}

# dg_analyze_port_holder <port>: what is already holding a host port, if
# anything. Docker first, since that is the usual answer.
# Always succeeds: "nothing holds this port" is an answer, not an error. The
# caller assigns the result, and under `set -e` a non-zero return here would
# abort the whole report: which is exactly what it used to do on a host
# without lsof.
dg_analyze_port_holder() {
  local port="$1" holder=""
  holder=$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null \
    | grep -E "(^| )[0-9.:]*:$port->" | awk '{print $1}' | head -1) || true
  if [ -z "$holder" ] && dg_have lsof; then
    holder=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1}') || true
  fi
  if [ -z "$holder" ] && dg_have ss; then
    holder=$(ss -ltnpH "sport = :$port" 2>/dev/null | sed -n 's/.*users:((\"\([^\"]*\)\".*/\1/p' | head -1) || true
  fi
  printf '%s' "$holder"
  return 0
}

dg_analyze_json() {
  local dir="$1" file="$2" json="$3"
  local overlay pname psource
  overlay=$(dg_analyze_has_overlay "$dir")
  IFS="$DG_FS" read -r pname psource <<EOF
$(dg_analyze_project_name "$dir")
EOF

  # Classification happens in shell, so it is folded back into the model here.
  local classes="{}" svc image
  while IFS="$DG_FS" read -r svc image; do
    [ -n "${svc:-}" ] || continue
    classes=$(printf '%s' "$classes" | dg_jq -c \
      --arg k "$svc" --arg v "$(dg_analyze_classify "$image" "$svc")" '. + {($k): $v}')
  done <<EOF
$(printf '%s' "$json" | dg_jq -r '.services | to_entries[] | [.key, (.value.image // "")] | join("\u001f")' 2>/dev/null)
EOF

  printf '%s' "$json" | dg_jq \
    --arg path "$dir" \
    --arg compose_file "$file" \
    --arg overlay "${overlay:-}" \
    --arg project "$pname" \
    --arg project_source "$psource" \
    --arg domain "$DEV_GATEWAY_DOMAIN" \
    --argjson classes "$classes" '
    {
      path: $path,
      compose_file: $compose_file,
      gateway_overlay: (if $overlay == "" then null else $overlay end),
      project: { name: $project, source: $project_source },
      domain: $domain,
      services: [
        .services | to_entries[] | {
          name: .key,
          image: (.value.image // null),
          kind: ($classes[.key] // "unknown"),
          container_name: (.value.container_name // null),
          published_ports: [ (.value.ports // [])[] | select(.published) |
                             { host: (.published|tostring), container: (.target|tostring) } ],
          container_ports: [ (.value.ports // [])[] | (.target|tostring) ],
          expose: (.value.expose // []),
          networks: ((.value.networks // {}) | keys),
          volumes: [ (.value.volumes // [])[] | (.source // .target // "") ]
        }
      ]
    }
    | .findings = {
        published_host_ports: [ .services[] | select(.published_ports | length > 0) | .name ],
        fixed_container_names: [ .services[] | select(.container_name) | .name ],
        published_datastores:  [ .services[] | select(.kind == "datastore" and (.published_ports | length > 0)) | .name ],
        implicit_namespace: ($project_source | test("implicit")),
        already_adopted: ($overlay != "")
      }
    '
}
