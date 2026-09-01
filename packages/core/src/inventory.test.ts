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
