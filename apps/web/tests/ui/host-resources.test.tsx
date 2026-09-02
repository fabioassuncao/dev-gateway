import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/ui/i18n/index.ts'
import { HostResourcesCard } from '../../src/ui/components/host-resources.tsx'
import type { HostResources } from '../../src/shared/types.ts'

function resources(overrides: Partial<HostResources> = {}): HostResources {
  return {
    system: {
      hostname: 'lab',
      os: 'Ubuntu 24.04',
      osVersion: '24.04',
      kernel: '6.8.0',
      architecture: 'x86_64',
      uptimeSeconds: 90000,
      source: 'mixed',
    },
    cpu: {
      model: 'Ryzen 9',
      cores: 16,
      utilisation: 0.2,
      load: { one: 0.4, five: 0.3, fifteen: 0.2 },
      source: 'mixed',
    },
    memory: {
      totalBytes: 32 * 1024 ** 3,
      usedBytes: 8 * 1024 ** 3,
      availableBytes: 24 * 1024 ** 3,
      usedPercent: 0.25,
      source: 'mixed',
    },
    storage: [],
    gpu: [],
    collectedAt: 1_700_000_000,
    ageSeconds: 12,
    stale: false,
    hint: null,
    ...overrides,
  }
}

function renderCard(data: HostResources) {
  const t = i18n.getFixedT('en', 'overview', 'host')
  return render(
    <I18nextProvider i18n={i18n}>
      <HostResourcesCard data={data} locale="en" t={t} />
    </I18nextProvider>,
  )
}

describe('the host resources card', () => {
  it('shows the static facts and a hint when nothing was collected', () => {
    renderCard(resources({
      system: { ...resources().system, uptimeSeconds: null, source: 'docker' },
      cpu: { model: null, cores: 8, utilisation: null, load: null, source: 'docker' },
      memory: { totalBytes: 16 * 1024 ** 3, usedBytes: null, availableBytes: null, usedPercent: null, source: 'docker' },
      collectedAt: null,
      ageSeconds: null,
      hint: 'portta host collect',
    }))
    expect(screen.getByText(/lab/)).toBeInTheDocument()
    expect(screen.getByText(/8 cores/)).toBeInTheDocument()
    expect(screen.getByText(/portta host collect/)).toBeInTheDocument()
    expect(screen.queryByText('GPU')).not.toBeInTheDocument()
  })

  it('warns when memory is past the threshold', () => {
    renderCard(resources({
      memory: {
        totalBytes: 10,
        usedBytes: 9,
        availableBytes: 1,
        usedPercent: 0.9,
        source: 'collector',
      },
    }))
    expect(screen.getAllByText('high').length).toBeGreaterThan(0)
  })

  it('shows a GPU only when one was collected', () => {
    renderCard(resources({
      gpu: [{ name: 'RTX 4090', memoryTotalBytes: 24, memoryUsedBytes: 4, utilisation: 0.3 }],
    }))
    expect(screen.getByText(/RTX 4090/)).toBeInTheDocument()
  })
})
