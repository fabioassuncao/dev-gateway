import { describe, expect, it } from 'vitest'
import { projectsFor, routesFor, type ContainerRecord } from './inventory.js'

const container: ContainerRecord = {
  id: '1', name: 'shop-web-1', image: 'nginx:1', state: 'running', ports: [], networks: ['portta'],
  labels: { 'traefik.enable': 'true', 'com.docker.compose.project': 'shop', 'com.docker.compose.service': 'web' },
}

describe('inventory', () => {
  it('derives routes from Compose labels', () => expect(routesFor([container], 'localhost')[0]?.url).toBe('http://shop-web.localhost'))
  it('groups services by project', () => expect(projectsFor([container], 'localhost')[0]?.name).toBe('shop'))
})

describe('routes without a hostname', () => {
  // The panel's public entrypoint carries `PathPrefix(`/`)` and is reached by
  // address, not by name. Deriving `portta-web.localhost` for it would list a
  // URL nothing answers on. See docs/development/adr/0021-panel-access-modes.md.
  it('a router with an explicit rule that names no host is not listed', () => {
    const routed: ContainerRecord = {
      ...container,
      name: 'portta-web-1',
      labels: {
        ...container.labels,
        'com.docker.compose.project': 'portta',
        'traefik.http.routers.portta-panel.rule': 'PathPrefix(`/`)',
      },
    }
    expect(routesFor([routed], 'localhost')).toEqual([])
  })

  it('an explicit Host rule still wins over the derived hostname', () => {
    const routed: ContainerRecord = {
      ...container,
      labels: { ...container.labels, 'traefik.http.routers.shop.rule': 'Host(`shop.example.test`)' },
    }
    expect(routesFor([routed], 'localhost')[0]?.hostname).toBe('shop.example.test')
  })

  it('and a container with no rule at all keeps the derived one', () => {
    expect(routesFor([container], 'localhost')[0]?.hostname).toBe('shop-web.localhost')
  })
})
