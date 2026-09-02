import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/ui/i18n/index.ts'
import { HostResourcesCard } from '../../src/ui/components/host-resources.tsx'
import type { MetricsCurrent } from '../../src/shared/types.ts'
import { emptySnapshot } from 'portta-core'

function current(overrides: Partial<MetricsCurrent> = {}): MetricsCurrent {
  const snapshot = emptySnapshot({ id: 'i', name: 'lab', hostname: 'lab' }, 1_700_000_000)
  snapshot.host.hostname = 'lab'
  snapshot.host.distro = 'macOS'
  snapshot.host.version = '15.4'
  snapshot.host.architecture = 'arm64'
  snapshot.host.cpu.brand = 'Apple M3 Pro'
  snapshot.host.cpu.logicalCores = 12
  snapshot.host.cpuUtilisation = 0.34
  snapshot.host.memoryTotalBytes = 36 * 1024 ** 3
  snapshot.host.memoryUsedBytes = 18 * 1024 ** 3
  snapshot.host.memoryUsedPercent = 0.5
  return {
    version: 1,
    instance: snapshot.instance,
    collectedAt: snapshot.collectedAt,
    ageSeconds: 4,
    stale: false,
    collectorActive: true,
    host: snapshot.host,
    runtime: { name: 'orbstack' },
    projects: [],
    ...overrides,
  }
}

function renderCard(data: MetricsCurrent) {
  const t = i18n.getFixedT('en', 'overview', 'host')
  return render(
    <I18nextProvider i18n={i18n}>
      <HostResourcesCard data={data} locale="en" t={t} />
    </I18nextProvider>,
  )
}

describe('the host resources card', () => {
  it('shows host facts and OrbStack as runtime, not as the machine', () => {
    renderCard(current())
    expect(screen.getAllByText(/Apple M3 Pro/).length).toBeGreaterThan(0)
    expect(screen.getByText(/34%/)).toBeInTheDocument()
    expect(screen.getByText('OrbStack')).toBeInTheDocument()
    expect(screen.queryByText('portta host collect')).not.toBeInTheDocument()
  })

  it('says the collector is inactive when there is no snapshot', () => {
    renderCard({
      version: 1,
      instance: { id: '', name: null, hostname: null },
      collectedAt: null,
      ageSeconds: null,
      stale: true,
      collectorActive: false,
      host: null,
      runtime: null,
      projects: [],
    })
    expect(screen.getByText('Collector inactive')).toBeInTheDocument()
    expect(screen.queryByText('GPU')).not.toBeInTheDocument()
  })

  it('shows a GPU only when one was collected', () => {
    const data = current()
    data.host!.gpu = [{ vendor: 'NVIDIA', model: 'RTX 4090', vramBytes: 24 * 1024 ** 3, utilisation: 0.3, temperature: null }]
    renderCard(data)
    expect(screen.getByText(/RTX 4090/)).toBeInTheDocument()
  })
})
