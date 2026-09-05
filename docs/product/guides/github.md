# Connect GitHub

Configure a GitHub App to synchronize repositories and issues with local Portta tasks. The integration is disabled until you enable it.

## Default posture

- No App configured: the panel behaves as it does today.
- App configured: outbound calls to `api.github.com` on the network the
  panel already has. No new Docker network.
- Webhooks off by default. A loopback panel cannot receive them, and a
  routed one refuses them until the signed path is exempted (step 7).
  Correctness comes from reconciliation. Webhooks are an optimisation
  for a panel the operator has already published.
- The panel stays refused on the public profile.
- Read-only mode refuses GitHub writes too.



## Setting it up

Ten minutes, at the end of which **Settings → GitHub** shows a connected App, the
installations it has, and the repositories they granted.

None of it needs a public address. The panel calls GitHub; GitHub does not call
the panel, unless you turn webhooks on in step 7, which is optional and which a
loopback panel should skip.

### Before you start

- Portta running, and the panel open.
- A GitHub account you can create an App on.
- A shell on the host. The private key is a **file you put there**, not a value
  the panel will accept — the panel can write its own `.env`, and must not be
  able to write the key that authenticates it.

### 1. Create the App

GitHub → *Settings* → *Developer settings* → *GitHub Apps* → *New GitHub App*.

| Field on the form | What to put | Why |
|---|---|---|
| **GitHub App name** | anything unique, e.g. `portta-<your account>` | GitHub requires it to be unique across all of GitHub |
| **Homepage URL** | anything at all, e.g. your repository | The form demands one; the panel never serves it |
| **Callback URL** | leave it empty | There is no OAuth flow. The panel never receives a redirect |
| **Setup URL** | leave it empty | The panel *discovers* its installations through `GET /app/installations`. It is never told about one |
| **Webhook → Active** | **unticked** | A loopback panel cannot receive a delivery. Step 7 turns this on if yours is already published |
| **Where can this App be installed** | *Only on this account* | The right answer for a development host |

Create the App, and keep the page open: the App id and the private key both come
from it.

### 2. Ask for these permissions, and no others

Under *Repository permissions*. Three of them are what the panel calls today:

| Permission | Access | The call it pays for |
|---|---|---|
| **Metadata** | Read | `GET /installation/repositories`. Mandatory — it is what lists repositories at all |
| **Issues** | Read and write | `GET`, `POST` and `PATCH /repos/{owner}/{repo}/issues`, and `…/issues/{n}/sub_issues`. The board writes back to GitHub |
| **Pull requests** | Read | GitHub's issues endpoint returns pull requests too, and a project page shows the open ones |

Three more belong to the phases after this one. Granting them now costs nothing
and saves a second trip through this form; leaving them out changes nothing you
can see today:

| Permission | Access | What it is for |
|---|---|---|
| **Contents** | Read | Repository shape beyond the default branch, which Metadata already carries |
| **Commit statuses** | Read | Whether checks passed |
| **Checks** | Read | The same, through the Checks API |

**Never `Contents: write`.** The panel does not commit, push, merge or rebase,
and an App that cannot write code cannot be talked into it.

### 3. Install it

*Install App* in the App's sidebar, then install it on your account and choose
between *All repositories* and *Only select repositories*.

That choice is the authorisation boundary. The panel refuses any operation on a
repository the installation did not grant, before it makes the request — so
picking a few repositories now is not a decision you have to get right: widening
it later is *Install App → Configure*, and the next **Sync** picks the change up.

### 4. Put the private key on the host

On the App's settings page, *Private keys* → *Generate a private key*. Your
browser downloads a `.pem`. In your Portta directory, on the host:

```bash
mkdir -p state/github
mv ~/Downloads/your-app.*.private-key.pem state/github/
chmod 600 state/github/*.pem
```

**The directory matters, the filename does not.** Compose mounts
`./state/github` into the panel read-only, and that mount is the only route the
key has into the container (`docker/compose/features/web.yaml`). So the .pem has
to live there, under whatever name you like: keep the one GitHub gave the
download, or rename it to `app.pem`, which is what the panel assumes when you
set nothing. Whichever you choose, step 5 is where you say so.

`chmod 600` is not ceremony. The panel checks the mode as it starts and writes
`… is readable by more than its owner: chmod 600 it`; `portta doctor` fails on
it. The key is read on **every** use rather than cached, so rotating it later is
a `mv` and needs no restart.

### 5. Fill in Settings → GitHub

Open the panel, go to **Settings → GitHub**, and fill the five fields in the
order they appear:

| Field on the screen | Key | What to put | Refused if |
|---|---|---|---|
| **GitHub App** (toggle) | `GITHUB_APP_ENABLED` | on | — |
| **App id** | `GITHUB_APP_ID` | the number at the top of the App's settings page, e.g. `123456` | it is not digits alone |
| **Private key file** | `GITHUB_APP_PRIVATE_KEY_FILE` | `/app/state/github/` and the filename you used in step 4 | it is not under `/app/state/github/` |
| **Webhook secret** | `GITHUB_APP_WEBHOOK_SECRET` | leave it empty for now | — |
| **API base URL** | `GITHUB_API_URL` | `https://api.github.com`, or `https://ghe.example.com/api/v3` on Enterprise Server | it is not a URL |
| **Reconciliation interval** | `GITHUB_SYNC_INTERVAL_MINUTES` | `15`, or `0` on a panel that receives webhooks | it is not a whole number |

Three of those are worth a sentence each.

The **App id** is the App id — not the App name, and not the client id. The
field takes digits and nothing else.

The **private key file** is the path *inside the container*, which is why it
begins `/app/` and not with your home directory. `state/github/` on the host is
`/app/state/github/` there, so a key you dropped in as
`portta.2026-09-02.private-key.pem` is
`/app/state/github/portta.2026-09-02.private-key.pem` here. The field is
refused if it points anywhere else, because nothing else is mounted and the
panel could not open it. Leave it empty and the panel reads
`/app/state/github/app.pem`.

This is the value both diagnostics use: the panel opens the file you name, and
`portta doctor` checks that same file on the host.

The **webhook secret** field shows *not set* or *set*, never a value. No secret
is ever returned by the API, and the `.env` it is written to is mode 600.

Then press **Save**. **Saving writes `.env`. It does not apply it** — which is
what the bar at the top of the page is telling you.

### 6. Apply it, and see that it worked

```bash
./bin/portta up local
portta doctor
```

`up local` recreates the container, and recreating is what makes a changed
`.env` take effect. **`portta web restart` will not do this**: it restarts the
process with the environment it already had, and the App stays invisible. On a
host with `PORTTA_APPLY=true`, the panel's own *Apply and restart* button
performs the same recreate for you.

`doctor` has three checks here, and they are silent when the App is off:

| Check | Passes when |
|---|---|
| `github.app` | the App is enabled and `GITHUB_APP_ID` is set |
| `github.key` | the `.pem` exists, is readable, and is mode `600` or `400` |
| `github.api` | `GITHUB_API_URL` is `https://` |

Now reload **Settings → GitHub**. The card that said *No GitHub App is
configured* shows a **connected** badge, `App <id> · <api url>`, and four
things:

- **Installations** — one badge each. A suspended installation says so, and the
  sync skips it.
- **Repositories** — how many those installations granted. Zero is not a
  failure; it is an installation that granted none. *Install App → Configure*
  is where that is fixed.
- **Rate limit** — what is left of the budget, and when it resets.
- **Last sync** — per scope, with the last error in red when there was one.

Press **Sync**. It is idempotent: two runs leave the same rows, move
`synced_at`, and prune whatever an installation no longer grants.

### 7. Webhooks, if the panel is already published (optional)

Skip this unless the panel has a URL GitHub can reach. Correctness does not
depend on a delivery — reconciliation is the baseline, and a webhook only makes
the panel notice sooner.

**A delivery has no session, and every other panel path requires one.** GitHub
sends no cookie and no Basic credential, so ForwardAuth refuses a delivery
before the panel ever sees it — a `401` with an empty body, and nothing in the
panel's log. One overlay exempts exactly one path from that middleware:

```text
docker/compose/features/panel-webhook.yaml
```

It is applied when `GITHUB_APP_ENABLED=true` **and** the panel is routed with
`PORTTA_WEB_EXPOSE=domain`. Both halves matter: `domain` is the only mode that
gives the panel a hostname over HTTPS, and GitHub will not deliver to the plain
HTTP the `panel` entrypoint serves. `portta doctor` warns when the App is on and
the panel is in any other mode, because the symptom otherwise is deliveries
GitHub retries and this host refuses, invisibly.

**Why that exemption is not a hole.** The path is not unauthenticated; it
authenticates differently, and for a machine-to-machine callback more strongly
than a cookie would. GitHub signs the raw body with HMAC-SHA256 under a secret
only it and this host know, and nothing is parsed before that check passes. A
session cookie would be the wrong instrument here — GitHub has no session, and
any scheme that let it in by origin or by address would trust something
forgeable.

It is **not** a general "these URLs are public" list, and Portta does not offer
one. Every other panel path authenticates by session and by nothing else, so
exempting any of them would open an unauthenticated door into an API that can
start, stop and remove containers. The router names one exact path with
`Path(...)`, never a prefix.

Generate a secret and keep it where you can paste it twice:

```bash
openssl rand -hex 32
```

On the App's settings page, under *Webhook*:

| Field | Value |
|---|---|
| **Active** | ticked |
| **Payload URL** | `https://<PORTTA_PANEL_ADVERTISED_HOST>/api/integrations/github/webhook` |
| **Content type** | `application/json` |
| **Secret** | the string you just generated |

Then *Permissions & events* → *Subscribe to events*, and tick exactly these
eight, which are the ones the panel acts on:

*Issues* · *Label* · *Milestone* · *Sub-issues* ·
*Pull request* · *Repository* · *Installation* · *Installation repositories*

*Issue comment* is deliberately **not** among them. Nothing projects a comment,
so a delivery would buy a whole repository reconciliation to refresh one
timestamp — on the event that fires most often in an active repository.

Anything else is acknowledged and dropped. An unhandled event is not an error.

Finally, paste the same secret into **Settings → GitHub → Webhook secret**, save,
and run `./bin/portta up local` again.

The signature is verified over the raw body, in constant time, *before* the body
is parsed as anything meaningful. An invalid one is a `401` that logs the
delivery id and nothing else. A delivery is a signal to re-read, never data to
trust, so nothing GitHub sends widens what the installation granted. Read-only
mode refuses the route outright.

**Where the secret lives.**
[ADR 0018](../../development/adr/0018-github-access-lives-in-the-panel.md) prescribed a file with
its path in `.env`, the shape the private key has. Today it is a write-only
`.env` value that the Settings page can set. The credential that *authenticates*
the App is the one that is a file, and that has not moved.

### When it does not work

| What you see | Why | Fix |
|---|---|---|
| *No GitHub App is configured*, after saving | `.env` was written; the container still has the old environment | `./bin/portta up local` |
| Save refuses the App id | it is validated as digits only | use the numeric id, not the App name and not the client id |
| Save refuses the key path | it must be under the one mounted directory | `/app/state/github/<your-file>.pem` |
| doctor: `enabled with no GITHUB_APP_ID` | the toggle is on and the id is empty | copy the id from the App's settings page |
| doctor: `no private key at …` | no `.pem` at the name the field gives, under `state/github/` | correct the filename on one side or the other |
| doctor: `… is outside /app/state/github/` | a path from before the field took effect | move the `.pem` into `state/github/` and re-point the field |
| doctor: `readable by more than its owner` | the key's mode | `chmod 600` the file doctor named |
| doctor: `GITHUB_API_URL is not https` | an API root without TLS | use an `https://` root |
| **unreachable**, *GitHub refused the App credentials* | the id and the key belong to different Apps, or the App was deleted | regenerate the key and re-copy the id |
| **Repositories: 0** after a Sync | the installation granted none | *Install App → Configure* on GitHub |
| An installation marked *(suspended)* | it is suspended on GitHub | unsuspend it; the sync skips suspended ones |
| `503` on an issues page | the panel's PostgreSQL is unavailable, not GitHub | [Persistence](../concepts/persistence.md) |
| The webhook answers `401` | the secret differs between GitHub and the panel | set the same string on both sides |

The rest of the panel is unaffected by any of these: a GitHub failure never
stops a Docker-backed page from answering. See [Troubleshooting](troubleshooting.md)
and [Security](../concepts/security.md).



## When GitHub is down

The GitHub endpoints answer `503` with a hint, exactly as the database's do.
The projected repository list still answers, because it is read from
PostgreSQL. Every Docker-backed page is unaffected: the panel never blocks a
snapshot on a network call it does not control.

Rate-limit exhaustion is a typed error rather than a 500, and the remaining
budget is on **Settings → GitHub** and in `GET /api/status` so it is visible
before it runs out.



## The API

| Endpoint | What it does |
|---|---|
| `GET /api/integrations/github` | Configuration, reachability, installations, repository count, rate-limit budget, last sync. Never a secret |
| `GET /api/integrations/github/repositories` | The projection, served from the database so it answers while GitHub is down |
| `POST /api/integrations/github/sync` | Idempotent re-sync. Refused in read-only mode |

`GET /api/status` carries the same `github` block, so one request tells an
agent whether the integration is usable.



See [GitHub synchronization](../concepts/github-sync.md) for source ownership and synchronization behavior.
