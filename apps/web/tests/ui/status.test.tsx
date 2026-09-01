import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OwnershipBadge, ScopeBadge, StateBadge } from '../../src/ui/components/status.tsx'

describe('the badges that carry the whole distinction', () => {
  it('names what the gateway manages and what it does not', () => {
    render(
      <>
        <OwnershipBadge ownership="gateway" />
        <OwnershipBadge ownership="integrated" />
        <OwnershipBadge ownership="external" />
        <OwnershipBadge ownership="standalone" />
      </>,
    )
    expect(screen.getByText('Dev Gateway')).toBeInTheDocument()
    expect(screen.getByText('Integrated')).toBeInTheDocument()
    expect(screen.getByText('External')).toBeInTheDocument()
    expect(screen.getByText('Standalone')).toBeInTheDocument()
  })

  it('folds health into the state when there is one', () => {
    const { rerender } = render(<StateBadge state="running" health="healthy" />)
    expect(screen.getByText('running · healthy')).toBeInTheDocument()

    rerender(<StateBadge state="running" health="none" />)
    expect(screen.getByText('running')).toBeInTheDocument()

    rerender(<StateBadge state="exited" />)
    expect(screen.getByText('exited')).toBeInTheDocument()
  })

  it('spells VPN in capitals, because that is what people look for', () => {
    render(
      <>
        <ScopeBadge scope="local" />
        <ScopeBadge scope="vpn" />
        <ScopeBadge scope="public" />
      </>,
    )
    expect(screen.getByText('VPN')).toBeInTheDocument()
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('public')).toBeInTheDocument()
  })
})
