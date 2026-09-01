#!/usr/bin/env bash
# `dev-gateway git`: what each environment is actually running.
#
# The panel cannot read a working tree and no acceptable variant of "let it"
# exists: mounting project directories, enabling EXEC, or generalising container
# creation each dismantle a documented guarantee. So this runs here instead, on
# the host, where `git` already is and where the Compose labels already say
# which directory belongs to which project.
#
# It writes one file per project under state/git/, which the panel mounts
# read-only. Nothing polls: the panel renders how old the file is and prints
# this command. See docs/adr/0010-git-collected-on-the-host.md.
#
# Read-only in both directions: no checkout, merge, rebase, fetch or push, no
# diffs, no file contents, and nothing beyond HEAD.

DG_GIT_DIR_MODE=700
DG_GIT_FILE_MODE=600

dg_git_state_dir() { printf '%s/git' "$DG_STATE_DIR"; }

dg_cmd_git() {
  local sub="${1:-status}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    scan) dg_git_scan "$@" ;;
    status|show) dg_git_status "$@" ;;
    clear) dg_git_clear "$@" ;;
    -h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway git: what each environment is running

  git scan [--project <name>] [--with-prs] [--forge-ttl <seconds>]
                         Read every running project's working tree and write
                         state/git/<project>.json for the panel
  git status [--json]    What was collected, and how old it is
  git clear              Remove the collected files

The panel reads those files and nothing else: it has no access to any project
directory, runs no shell commands, and never polls. Run this from `dev-gateway
up`, from a cron, or by hand.

Local `git` only, unless --with-prs adds the open pull requests through `gh`,
reusing the authentication you already have. There is no token to store, no
rate limit of ours to account for, and nothing is ever written to a repository.
Without `gh`, or signed out, the file simply has no forge block and the panel
shows no GitHub section.

See docs/adr/0010-git-collected-on-the-host.md.
DG_HELP
      ;;
    *) err "unknown git subcommand: $sub"; hint "dev-gateway git --help"; return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

# dg_git_projects [project]: one line per running Compose project.
#
#   project<FS>directory<FS>declared-repo
#
# The directory is `dev-gateway.git.root` when a project declared one, and the
# Compose working directory otherwise. Gateway-owned containers are skipped:
# they are infrastructure, not somebody's environment.
dg_git_projects() {
  local want="${1:-}" id project dir root repo seen=""
  local FS; FS=$(printf '\037')

  for id in $(docker ps -q 2>/dev/null); do
    project=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null)
    [ -n "$project" ] || continue
    dg_container_is_managed "$id" && continue
    [ -z "$want" ] || [ "$want" = "$project" ] || continue
    case " $seen " in *" $project "*) continue ;; esac
    seen="$seen $project"

    dir=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null)
    root=$(docker inspect "$id" --format '{{ index .Config.Labels "dev-gateway.git.root" }}' 2>/dev/null)
    repo=$(docker inspect "$id" --format '{{ index .Config.Labels "dev-gateway.repo" }}' 2>/dev/null)
    [ -n "$root" ] && dir="$root"

    printf '%s%s%s%s%s\n' "$project" "$FS" "$dir" "$FS" "$repo"
  done | sort
}

# ---------------------------------------------------------------------------
# Reading one working tree
# ---------------------------------------------------------------------------

# dg_git_in <dir> <git args...>: read-only git, with the surrounding
# environment neutralised so a caller's GIT_DIR or pager cannot change what is
# collected or block on a prompt.
#
# `env -u`, not `GIT_DIR=`: an empty GIT_DIR is not an absent one, and git
# answers "not a git repository: ''" to every command in a directory that is
# plainly a repository.
dg_git_in() {
  local dir="$1"; shift
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE \
    GIT_PAGER=cat GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 \
    git -C "$dir" "$@" 2>/dev/null
}

dg_git_is_repo() {
  [ -d "${1:-}" ] || return 1
  [ "$(dg_git_in "$1" rev-parse --is-inside-work-tree)" = "true" ]
}

# dg_git_counts <dir>: staged<FS>unstaged<FS>untracked, from one status call.
#
# porcelain=v2 gives a stable two-character XY per changed path: X is what is
# staged, Y is what is not, and `.` means unchanged on that side. A path can be
# both, which is why these are counted separately rather than summed.
dg_git_counts() {
  local dir="$1" FS; FS=$(printf '\037')
  dg_git_in "$dir" status --porcelain=v2 --untracked-files=normal 2>/dev/null | awk -v FS_OUT="$FS" '
    /^[12] / { xy = $2; if (substr(xy,1,1) != ".") staged++; if (substr(xy,2,1) != ".") unstaged++ }
    /^u /    { unmerged++ }
    /^\? /   { untracked++ }
    END { printf "%d%s%d%s%d%s%d", staged+0, FS_OUT, unstaged+0, FS_OUT, untracked+0, FS_OUT, unmerged+0 }
  '
}

# dg_git_json <project> <dir> <declared-repo>: the whole record for one project.
dg_git_json() {
  local project="$1" dir="$2" declared="${3:-}"
  local now; now=$(date +%s)

  printf '{\n'
  printf '  "project": "%s",\n' "$(dg_json_escape "$project")"
  printf '  "workingDir": "%s",\n' "$(dg_json_escape "$dir")"
  printf '  "collectedAt": %s,\n' "$now"

  if ! dg_git_is_repo "$dir"; then
    # A real answer, not a missing one: the panel can then say nothing about
    # Git rather than "never scanned". Projects without Git are normal.
    printf '  "git": null,\n'
    printf '  "reason": "%s"\n' "$([ -d "$dir" ] && printf 'not a git repository' || printf 'directory not readable from the host')"
    printf '}\n'
    return 0
  fi

  local branch sha short subject author date upstream ab ahead behind remote
  branch=$(dg_git_in "$dir" rev-parse --abbrev-ref HEAD)
  sha=$(dg_git_in "$dir" rev-parse HEAD)
  short=$(dg_git_in "$dir" rev-parse --short HEAD)
  subject=$(dg_git_in "$dir" log -1 --format=%s)
  author=$(dg_git_in "$dir" log -1 --format=%an)
  date=$(dg_git_in "$dir" log -1 --format=%ct)
  upstream=$(dg_git_in "$dir" rev-parse --abbrev-ref '@{upstream}')

  ahead=0; behind=0
  if [ -n "$upstream" ]; then
    ab=$(dg_git_in "$dir" rev-list --left-right --count "$upstream...HEAD")
    behind=$(printf '%s' "$ab" | awk '{print $1+0}')
    ahead=$(printf '%s' "$ab" | awk '{print $2+0}')
  fi

  remote=$(dg_git_in "$dir" remote get-url origin)
  if [ -z "$remote" ]; then
    remote=$(dg_git_in "$dir" remote | head -1)
    [ -n "$remote" ] && remote=$(dg_git_in "$dir" remote get-url "$remote")
  fi
  # A declared dev-gateway.repo label wins: the project said what it is, and a
  # local clone URL is a weaker answer than a deliberate one.
  [ -n "$declared" ] && remote="$declared"

  local staged unstaged untracked unmerged FS; FS=$(printf '\037')
  IFS="$FS" read -r staged unstaged untracked unmerged <<EOF
$(dg_git_counts "$dir")
EOF

  local detached=false
  [ "$branch" = "HEAD" ] && detached=true

  printf '  "git": {\n'
  printf '    "branch": %s,\n' "$([ "$detached" = "true" ] && printf 'null' || printf '"%s"' "$(dg_json_escape "$branch")")"
  printf '    "detached": %s,\n' "$detached"
  printf '    "head": {"sha": "%s", "shortSha": "%s", "subject": "%s", "author": "%s", "date": %s},\n' \
    "$(dg_json_escape "$sha")" "$(dg_json_escape "$short")" \
    "$(dg_json_escape "$subject")" "$(dg_json_escape "$author")" "${date:-0}"
  printf '    "staged": %s,\n' "${staged:-0}"
  printf '    "unstaged": %s,\n' "${unstaged:-0}"
  printf '    "untracked": %s,\n' "${untracked:-0}"
  printf '    "unmerged": %s,\n' "${unmerged:-0}"
  printf '    "dirty": %s,\n' "$([ "$(( ${staged:-0} + ${unstaged:-0} + ${untracked:-0} + ${unmerged:-0} ))" -gt 0 ] && printf 'true' || printf 'false')"
  printf '    "upstream": %s,\n' "$([ -n "$upstream" ] && printf '"%s"' "$(dg_json_escape "$upstream")" || printf 'null')"
  printf '    "ahead": %s,\n' "${ahead:-0}"
  printf '    "behind": %s,\n' "${behind:-0}"
  printf '    "remote": %s\n' "$([ -n "$remote" ] && printf '"%s"' "$(dg_json_escape "$remote")" || printf 'null')"
  printf '  }'
  dg_git_forge_block "$project" "$remote"
  printf '\n}\n'
}

# ---------------------------------------------------------------------------
# The forge block: open pull requests, through `gh`
# ---------------------------------------------------------------------------
# Opt-in, and deliberately not the GitHub API with a token in .env: `gh` is
# already authenticated on a developer's machine, so there is no new credential
# to store and none to leak from a panel that may be routed. No `gh`, no forge
# block, no GitHub section in the UI.

DG_GIT_WITH_PRS=0
DG_GIT_FORGE_TTL=300
DG_GIT_FORGE_LIMIT=10

# dg_git_remote_slug <remote>: host<FS>owner/name, or nothing.
#
# Mirrors parseRemote in web/src/server/core/forge.ts closely enough for `gh
# -R host/owner/repo`, which is all this needs.
dg_git_remote_slug() {
  local remote="${1:-}" host slug FS
  FS=$(printf '\037')
  [ -n "$remote" ] || return 0

  case "$remote" in
    *://*)
      host=$(printf '%s' "$remote" | sed -e 's#^[a-z+]*://##' -e 's#^[^@]*@##' -e 's#[/:].*$##')
      slug=$(printf '%s' "$remote" | sed -e 's#^[a-z+]*://##' -e 's#^[^@]*@##' -e 's#^[^/]*/##') ;;
    *:*)
      host=$(printf '%s' "$remote" | sed -e 's#^[^@]*@##' -e 's#:.*$##')
      slug=$(printf '%s' "$remote" | sed -e 's#^[^:]*:##') ;;
    */*)
      # A bare owner/name from a dev-gateway.repo label.
      host="github.com"; slug="$remote" ;;
    *) return 0 ;;
  esac

  slug=$(printf '%s' "$slug" | sed -e 's#\.git$##' -e 's#^/##' -e 's#/$##')
  [ -n "$host" ] && [ -n "$slug" ] || return 0
  printf '%s%s%s' "$host" "$FS" "$slug"
}

# dg_git_forge_fresh <project>: the forge block from the previous scan, when it
# is younger than the TTL. `gh` is a network call per project, so a scan loop
# over ten projects should not make ten of them a minute apart.
dg_git_forge_fresh() {
  local file now collected
  file="$(dg_git_state_dir)/$1.json"
  [ -f "$file" ] || return 1
  now=$(date +%s)
  collected=$(printf '%s' "$(cat "$file")" | dg_jq -r '.forge.collectedAt // empty' 2>/dev/null)
  case "$collected" in ''|*[!0-9]*) return 1 ;; esac
  [ "$(( now - collected ))" -lt "$DG_GIT_FORGE_TTL" ] || return 1
  printf '%s' "$(cat "$file")" | dg_jq -c '.forge' 2>/dev/null
}

dg_git_forge_block() {
  local project="$1" remote="${2:-}" host slug cached prs FS
  [ "$DG_GIT_WITH_PRS" = "1" ] || return 0
  FS=$(printf '\037')

  IFS="$FS" read -r host slug <<EOF
$(dg_git_remote_slug "$remote")
EOF
  [ -n "${host:-}" ] && [ -n "${slug:-}" ] || return 0
  # Only forges `gh` can talk to. A GitLab or Bitbucket remote keeps its
  # derived links from the git block and gets no pull requests, which is the
  # documented degradation rather than a failure.
  case "$host" in *github*) ;; *) return 0 ;; esac

  if cached=$(dg_git_forge_fresh "$project"); then
    [ -n "$cached" ] && [ "$cached" != "null" ] && printf ',\n  "forge": %s' "$cached"
    return 0
  fi

  local now; now=$(date +%s)
  if ! gh auth status --hostname "$host" >/dev/null 2>&1; then
    printf ',\n  "forge": {"kind": "github", "collectedAt": %s, "authenticated": false, "pulls": [], "reason": "gh is not signed in to %s"}' \
      "$now" "$(dg_json_escape "$host")"
    return 0
  fi

  prs=$(gh pr list --repo "$host/$slug" --state open --limit "$DG_GIT_FORGE_LIMIT" \
    --json number,title,state,isDraft,reviewDecision,url,headRefName,statusCheckRollup 2>/dev/null)
  if [ -z "$prs" ]; then
    # A repository nobody can see, a network that is down, or genuinely no
    # pull requests: reported as an answered query with none, because `gh`
    # returning nothing at all is indistinguishable from an empty list here.
    prs='[]'
  fi

  prs=$(printf '%s' "$prs" | dg_jq -c '[ .[] | {
      number, title, state,
      draft: .isDraft,
      reviewDecision: (.reviewDecision // null),
      url, headRefName,
      checks: (
        if (.statusCheckRollup // []) | length == 0 then null
        elif [ .statusCheckRollup[] | .conclusion? // .state? ]
             | any(. == "FAILURE" or . == "ERROR" or . == "TIMED_OUT" or . == "CANCELLED") then "failing"
        elif [ .statusCheckRollup[] | .conclusion? // .state? ]
             | any(. == null or . == "" or . == "PENDING" or . == "IN_PROGRESS" or . == "QUEUED") then "pending"
        else "passing" end
      )
    } ]' 2>/dev/null) || prs='[]'
  [ -n "$prs" ] || prs='[]'

  printf ',\n  "forge": {"kind": "github", "collectedAt": %s, "authenticated": true, "pulls": %s}' \
    "$now" "$prs"
}

# ---------------------------------------------------------------------------
# scan
# ---------------------------------------------------------------------------

dg_git_scan() {
  local project=""
  DG_GIT_WITH_PRS=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --project) shift; project="${1:-}" ;;
      --project=*) project="${1#--project=}" ;;
      --with-prs) DG_GIT_WITH_PRS=1 ;;
      --forge-ttl) shift; DG_GIT_FORGE_TTL="${1:-300}" ;;
      --forge-ttl=*) DG_GIT_FORGE_TTL="${1#--forge-ttl=}" ;;
      -*) die "unknown flag for 'git scan': $1" ;;
      *) die "unexpected argument: $1" ;;
    esac
    shift
  done

  case "$DG_GIT_FORGE_TTL" in
    ''|*[!0-9]*) die "--forge-ttl must be a number of seconds" ;;
  esac

  if [ "$DG_GIT_WITH_PRS" = "1" ] && ! dg_have gh; then
    warn "gh is not installed; collecting Git without pull requests"
    hint "the panel shows no GitHub section rather than an error"
    DG_GIT_WITH_PRS=0
  fi

  dg_require_docker || return 1
  dg_have git || {
    err "git is not installed on this host"
    hint "the panel reads what this command collects; without git there is nothing to collect"
    return 1
  }

  local dir
  dir=$(dg_git_state_dir)
  mkdir -p "$dir" || die "could not create $dir"
  chmod "$DG_GIT_DIR_MODE" "$dir" 2>/dev/null || true

  local rows count=0 skipped=0 name pdir declared file FS
  FS=$(printf '\037')
  rows=$(dg_git_projects "$project")

  if [ -z "$rows" ]; then
    warn "no running Compose project to scan"
    hint "start a project, or pass --project <name> for one that is running"
    return 0
  fi

  while IFS="$FS" read -r name pdir declared; do
    [ -n "${name:-}" ] || continue
    # The file name is the Compose project, which Docker already constrains to
    # a safe shape; refuse anything else rather than writing outside the dir.
    case "$name" in
      *[!A-Za-z0-9_.-]*|.*|'') skipped=$((skipped + 1)); continue ;;
    esac

    file="$dir/$name.json"
    if dg_git_json "$name" "$pdir" "$declared" > "$file.dg-tmp.$$"; then
      chmod "$DG_GIT_FILE_MODE" "$file.dg-tmp.$$"
      mv "$file.dg-tmp.$$" "$file"
      count=$((count + 1))
    else
      rm -f "$file.dg-tmp.$$"
      skipped=$((skipped + 1))
    fi
  done <<EOF
$rows
EOF

  ok "collected $count project(s) into ${dir#"$DG_ROOT"/}"
  [ "$skipped" = "0" ] || warn "$skipped project(s) could not be read"
  hint "the panel reads these; it never runs git itself"
}

# ---------------------------------------------------------------------------
# status and clear
# ---------------------------------------------------------------------------

dg_git_status() {
  local as_json=0 project=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --json) as_json=1 ;;
      --project) shift; project="${1:-}" ;;
      --project=*) project="${1#--project=}" ;;
      *) die "unknown argument: $1" ;;
    esac
    shift
  done

  local dir file name now age first=1
  dir=$(dg_git_state_dir)
  now=$(date +%s)

  if [ "$as_json" = "1" ]; then
    printf '{\n  "directory": "%s",\n  "projects": [\n' "$(dg_json_escape "$dir")"
    for file in "$dir"/*.json; do
      [ -f "$file" ] || continue
      name=$(basename "$file" .json)
      [ -z "$project" ] || [ "$project" = "$name" ] || continue
      [ "$first" = "1" ] || printf ',\n'
      first=0
      printf '    %s' "$(cat "$file")"
    done
    printf '\n  ]\n}\n'
    return 0
  fi

  if [ ! -d "$dir" ] || [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
    warn "nothing collected yet"
    hint "dev-gateway git scan"
    return 0
  fi

  printf '%s\n' "$(dg_bold 'Collected Git metadata')"
  printf '  %-28s %-26s %s\n' "PROJECT" "BRANCH" "COLLECTED"
  for file in "$dir"/*.json; do
    [ -f "$file" ] || continue
    name=$(basename "$file" .json)
    [ -z "$project" ] || [ "$project" = "$name" ] || continue
    local branch collected
    branch=$(sed -n 's/.*"branch": "\([^"]*\)".*/\1/p' "$file" | head -1)
    collected=$(sed -n 's/.*"collectedAt": \([0-9]*\).*/\1/p' "$file" | head -1)
    age=$(( now - ${collected:-0} ))
    printf '  %-28s %-26s %s\n' "$name" "${branch:-<no git>}" "$(dg_git_age "$age")"
  done
  printf '\n'
  hint "dev-gateway git scan refreshes them"
}

dg_git_age() {
  local seconds="${1:-0}"
  if [ "$seconds" -lt 90 ]; then printf '%ss ago' "$seconds"
  elif [ "$seconds" -lt 5400 ]; then printf '%sm ago' "$(( seconds / 60 ))"
  elif [ "$seconds" -lt 172800 ]; then printf '%sh ago' "$(( seconds / 3600 ))"
  else printf '%sd ago' "$(( seconds / 86400 ))"; fi
}

dg_git_clear() {
  local dir
  dir=$(dg_git_state_dir)
  [ -d "$dir" ] || { ok "nothing to remove"; return 0; }
  dg_confirm "Remove the collected Git metadata in ${dir#"$DG_ROOT"/}?" || return 1
  # Only the files this command writes, never the directory's other contents.
  rm -f "$dir"/*.json
  ok "collected metadata removed; no repository was touched"
}
