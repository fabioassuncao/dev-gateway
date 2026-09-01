import { expect, test } from '@playwright/test'

const DOCKER_PORT = process.env.DG_E2E_DOCKER_PORT ?? '9911'

test.describe('the panel end to end', () => {
  // Every test describes the same host, whatever the previous one did to it.
  test.beforeEach(async ({ request }) => {
    await request.post(`http://127.0.0.1:${DOCKER_PORT}/__reset`)
  })

  test('the overview answers whether the gateway is healthy', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
    await expect(page.getByText('Gateway running')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Projects' })).toContainText('1')
    await expect(page.getByRole('group', { name: 'Routed URLs' })).toContainText('1')
    await expect(page.getByText('http://alpha-web.localhost')).toBeVisible()
  })

  test('a URL can be copied in one click', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')

    await page.getByRole('button', { name: 'Copy' }).first().click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe('http://alpha-web.localhost')
  })

  test('projects show their services, databases included', async ({ page }) => {
    await page.goto('/#/projects')

    await expect(page.getByText('alpha', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'web', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'postgres', exact: true })).toBeVisible()
  })

  test('the Docker page keeps external containers apart from the projects', async ({ page }) => {
    await page.goto('/#/docker')

    const external = page.getByRole('table', { name: 'External Docker' })
    await expect(external.getByText('legacy-postgres')).toBeVisible()
    await expect(external.getByText('alpha-web-1')).toHaveCount(0)

    await expect(page.getByRole('table', { name: 'Standalone containers' })).toContainText('mailpit')
    await expect(page.getByRole('table', { name: 'Dev Gateway' })).toContainText(
      'dev-gateway-traefik-1',
    )
  })

  test('filters and search narrow the list', async ({ page }) => {
    await page.goto('/#/docker')

    await page.getByLabel('Filter by ownership').selectOption('external')
    await expect(page.getByRole('table', { name: 'Integrated projects' })).toHaveCount(0)
    await expect(page.getByRole('table', { name: 'External Docker' })).toBeVisible()

    await page.getByLabel('Filter by ownership').selectOption('all')
    await page.getByLabel('Search containers').fill('mailpit')
    await expect(page.getByRole('table', { name: 'Standalone containers' })).toContainText('mailpit')
    await expect(page.getByRole('table', { name: 'External Docker' })).toHaveCount(0)
  })

  test('an external container can be stopped and started again', async ({ page }) => {
    await page.goto('/#/docker')

    const row = () =>
      page.getByRole('table', { name: 'External Docker' }).getByRole('row', { name: /legacy-postgres/ })

    await row().getByRole('button', { name: /Actions for legacy-postgres/ }).click()
    await page.getByRole('menuitem', { name: 'Stop', exact: true }).click()
    await expect(row()).toContainText('exited')

    await row().getByRole('button', { name: /Actions for legacy-postgres/ }).click()
    await page.getByRole('menuitem', { name: 'Start', exact: true }).click()
    await expect(row()).toContainText('running')
  })

  test('logs are readable and filterable', async ({ page }) => {
    await page.goto('/#/docker')

    await page
      .getByRole('table', { name: 'External Docker' })
      .getByRole('row', { name: /legacy-postgres/ })
      .getByRole('button', { name: 'Logs' })
      .click()
    await expect(page.getByText('ready to accept connections')).toBeVisible()

    await page.getByLabel('Filter log lines').fill('warning')
    await expect(page.getByText('ready to accept connections')).toHaveCount(0)
    await expect(page.getByText('a warning nobody reads')).toBeVisible()
  })

  test('removing an external container warns about its volume first', async ({ page }) => {
    await page.goto('/#/docker')

    await page
      .getByRole('table', { name: 'External Docker' })
      .getByRole('row', { name: /legacy-postgres/ })
      .getByRole('button', { name: /Actions for legacy-postgres/ })
      .click()
    await page.getByRole('menuitem', { name: 'Remove container' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Remove this container?')).toBeVisible()
    await expect(dialog.getByText('legacy_pgdata').first()).toBeVisible()
    await expect(dialog.getByText(/never removes a volume, and never runs a prune/)).toBeVisible()

    await dialog.getByRole('button', { name: 'Remove container' }).click()
    await expect(page.getByRole('table', { name: 'External Docker' })).toHaveCount(0)

    // The project it belonged to is untouched.
    await expect(page.getByRole('table', { name: 'Integrated projects' })).toContainText('alpha-web-1')
  })

  test('a TCP bridge can be opened from the Access page', async ({ page }) => {
    await page.goto('/#/access')

    const services = page.getByRole('table', { name: 'TCP services' })
    await expect(services).toContainText('postgres')
    await services.getByRole('button', { name: 'Open local access' }).first().click()

    // The bridge shows up with a loopback address to copy, and no error.
    await expect(page.getByText(/could not open the bridge/)).toHaveCount(0)
    await expect(page.getByRole('table', { name: 'Open bridges' })).toContainText('127.0.0.1:55432')
    await expect(page.getByText('postgresql://<user>@127.0.0.1:55432/<database>')).toBeVisible()

    await page.getByRole('button', { name: 'Close' }).first().click()
    await expect(page.getByText('No bridge is open')).toBeVisible()
  })

  test('the network page lists the routed hostnames and the shared network', async ({ page }) => {
    await page.goto('/#/network')

    await expect(page.getByText('alpha-web.localhost')).toBeVisible()
    await expect(page.getByText('dev-gateway', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('internal').first()).toBeVisible()
  })

  test('the gateway page runs diagnostics on demand', async ({ page }) => {
    await page.goto('/#/gateway')

    await page.getByRole('button', { name: 'Run diagnostics' }).click()
    await expect(page.getByText('Traefik').first()).toBeVisible()
    await expect(page.getByText('./bin/dev-gateway doctor')).toBeVisible()
  })

  test('settings never reveal a secret', async ({ page }) => {
    await page.goto('/#/settings')

    const token = page.getByLabel('Tailscale auth key')
    await expect(token).toHaveAttribute('type', 'password')
    await expect(token).toHaveValue('')
    await expect(page.locator('body')).not.toContainText('fixture-value-never-returned')
  })

  test('the offline API browser filters operations and tries a GET', async ({ page }) => {
    await page.goto('/api/docs')

    await expect(page.getByRole('heading', { name: 'Dev Gateway API' })).toBeVisible()
    await page.getByLabel('Filter API operations').fill('health')
    const operation = page.locator('details.route').filter({ hasText: '/health' })
    await expect(operation).toBeVisible()
    await operation.locator(':scope > summary').click()
    await operation.getByRole('button', { name: 'Try GET' }).click()
    await expect(operation.getByText('200 OK')).toBeVisible()
    await expect(operation.locator('pre').first()).toContainText('panelVersion')
  })

  test('the theme can be switched', async ({ page }) => {
    await page.goto('/')
    const html = page.locator('html')
    const before = await html.getAttribute('class')

    await page.getByRole('button', { name: 'Toggle theme' }).click()
    await expect(html).not.toHaveAttribute('class', before ?? '')
  })
})
