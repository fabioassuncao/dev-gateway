# Manage projects

## Projects

Every page below is a route, not a tab held in memory: `/projects`,
`/projects/<slug>`, `/projects/<slug>/tasks`, and so on. Each one is a link
somebody can paste, a bookmark that survives a reload, and a step the browser's
back button walks. What a role may not do is not shown rather than shown
disabled — the exception is a task's own controls, which stay visible and
inert, because a task's status is information a viewer came to read.

![Projects as cards: each with its state, its counts, its last commit and the actions its state allows](../../images/panel-projects.png)

The products you recognise, as cards or as a table: repositories, open tasks,
who is working, running environments, health, last commit and last activity.
**New project** creates one; a Project needs the panel's database and the page
says so when it is down. `Environments on this host` opens the list of every
Compose project Docker is running, adopted or not.

Both views are places to act, not only to look. A card carries the one action
its state allows — start what is stopped, stop what is running — and a menu
with the rest: tasks, repositories, environments, settings, archive, delete.
An action that could not change anything is not offered.

![Projects as a table: state, environments, repositories, open and blocked tasks, agents and last activity, with selection and column controls](../../images/panel-projects-table.png)

The table sorts on any column, hides the ones a given host does not care about,
and selects rows for a bulk start, stop, restart or archive. The arrangement is
remembered per table. Nothing destructive happens without saying what it will
do: stopping a project names its environments and counts its containers,
and deleting one asks for its slug and states what survives.
The panel classifies a Project's location against Projects Home by comparing
paths the host scan reported; it never mounts Projects Home or any project
directory.

Opening a Project is the cockpit. The header carries its health, its tasks and
sessions, an **Open / Test** menu for its primary environment and **New task**;
below it, tabs that are URLs:

| Tab | What it holds |
|---|---|
| **Overview** | Development status (in progress, blocked, next, active sessions), the repositories with their git state, the environments with their services and an Open / Test each, the recent activity, and the resources the project uses |
| **Tasks** | The board and the list, below |
| **Repositories** | Each repository as a row; **Add repository** offers what the host scan discovered, what the GitHub App was granted, or a path typed by hand |
| **Environments** | The environments adopted, why each was adopted, and **Adopt** for one that was not |
| **Activity** | The timeline: tasks moved, notes, sessions, environments started and stopped, commits the scan noticed |
| **Settings** | Name, description, place under Projects Home, archive, and delete — which removes what only Portta holds and names it |


## Repositories

`/projects/<slug>/repositories/<id>` is one repository: branch, HEAD, the
working tree spelled out, ahead/behind, the remote, the directory on the host,
and three tabs — the overview with open pull requests and the environments
running from it, the last twenty commits, and the **instruction files** the
host collected (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, …) with their
content and whether they differ from HEAD.

None of it is live. `portta repos scan` collects it on the host and the
metrics watcher repeats it once a minute; every block says how old it is and
carries the command that refreshes it. See
[ADR 0010](../../development/adr/0010-git-collected-on-the-host.md) and the amendment in
[ADR 0032](../../development/adr/0032-portta-development-model.md).
