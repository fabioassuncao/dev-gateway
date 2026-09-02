// Applying saved settings, from the panel.
//
// Traefik reads its static configuration from the environment its container was
// created with (ADR 0003), so a saved setting takes effect only once the gateway
// containers are *recreated* — and recreating them means Compose, which this
// process deliberately cannot reach (ADR 0008). The host closes that gap by
// preparing one container, stopped, whose command is fixed at creation time:
// `portta up`, with no argument this panel can influence. Starting a container
// is a permission the panel already had. See ADR 0026.
//
// Every field below is read back from that container rather than remembered
// here, because the apply recreates this process: whatever we held in memory is
// gone by the time there is an answer to report.

import type { DockerClient } from '../docker/client.ts'
import type { PanelConfig } from '../config.ts'
import type { Snapshot } from './inventory.ts'
import { componentOf } from './gateway.ts'
import { buildConfigView } from './configview.ts'
import type { ApplyState, ApplyStatus, ConfigField } from '../../shared/types.ts'

/** The label `portta up` puts on the container it prepares. */
export const APPLY_COMPONENT = 'apply'

const LOG_TAIL = 40

/**
 * Saved keys that change where this panel answers. When one of them is pending,
 * the browser tab watching the apply will never reconnect on its own, and a
 * progress dialog that does not say so is a hang dressed up as a wait.
 *
 * PORTTA_DOMAIN is here only when the panel is routed: on loopback the address
 * is an IP and a port, which the domain does not touch.
 */
const MOVES_PANEL = ['PORTTA_WEB_PORT', 'PORTTA_WEB_BIND_ADDRESS', 'PORTTA_WEB_EXPOSE']

/** Docker writes a zero time rather than an absent one; both mean "never". */
function seconds(value: string | undefined | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) || ms <= 0 ? null : Math.floor(ms / 1000)
}

function movesPanel(pending: ConfigField[], config: PanelConfig): boolean {
  const keys = pending.map((field) => field.key)
  if (keys.some((key) => MOVES_PANEL.includes(key))) return true
  return config.webExpose !== 'local' && keys.includes('PORTTA_DOMAIN')
}

export function applier(snapshot: Snapshot) {
  return componentOf(snapshot, APPLY_COMPONENT)
}

export async function applyStatus(
  client: DockerClient,
  snapshot: Snapshot,
  config: PanelConfig,
  options: { logs?: boolean } = {},
): Promise<ApplyStatus> {
  const view = buildConfigView(config)
  const pending = view.fields.filter((field) => field.pending)
  const common = {
    pendingRestart: view.pendingRestart,
    pendingKeys: pending.map((field) => field.key),
    movesPanel: movesPanel(pending, config),
    profile: config.profile,
    applyCommand: view.applyCommand,
  }

  const container = applier(snapshot)
  if (!container) {
    return {
      ...common,
      state: 'unavailable',
      available: false,
      // Two different situations, and the fix differs: one is a setting, the
      // other is a command. Saying "unavailable" for both would send the
      // operator looking in the wrong place.
      reason: 'set PORTTA_APPLY=true on the host, then run the command once',
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      logTail: [],
    }
  }

  const inspect = await client.inspect(container.id)
  const startedAt = seconds(inspect.State.StartedAt)
  const finishedAt = seconds(inspect.State.FinishedAt)

  // An exit code only describes a run that happened. A container that is still
  // running has not produced one, and one that was created and never started
  // carries whatever Docker left there — reporting either as a result would be
  // inventing an outcome.
  const ran = startedAt !== null
  const exitCode = ran && !inspect.State.Running ? (inspect.State.ExitCode ?? null) : null

  const state: ApplyState = inspect.State.Running
    ? 'running'
    : !ran
      ? 'idle'
      : exitCode === 0
        ? 'ok'
        : 'failed'

  // `docker start` on an exited container appends to the same log, so a bare
  // tail would show the previous apply. Read only what this run wrote.
  const wanted = options.logs === true || state === 'failed'
  const logTail = wanted
    ? (await client.logs(container.id, { tail: LOG_TAIL, since: startedAt ?? undefined }))
        .map((line) => line.text)
    : []

  return { ...common, state, available: true, reason: null, startedAt, finishedAt, exitCode, logTail }
}
