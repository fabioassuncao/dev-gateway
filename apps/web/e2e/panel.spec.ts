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

  test('every section owns its title and project context can refine it', async ({ page }) => {
    await page.goto('/#/overview')

    const sections = ['Overview', 'Workspaces', 'Projects', 'Services', 'Docker', 'Network', 'Access', 'Gateway']
    for (const section of sections) {
      await page.getByRole('button', { name: section, exact: true }).click()
      await expect(page).toHaveTitle(`${section} · Dev Gateway`)
    }

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/#\/settings\/gateway$/)
    await expect(page).toHaveTitle('Gateway · Settings · Dev Gateway')

    await page.goto('/#/projects/alpha')
    await expect(page).toHaveTitle('alpha · Dev Gateway')
  })

  test('workspaces explain themselves when the database is not running', async ({ page }) => {
    await page.goto('/#/workspaces')
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
    // No PostgreSQL in the demo host: a decision needs persistence, and the
    // page says so instead of failing.
    await expect(page.getByText("Workspaces need the panel's database")).toBeVisible()
    await expect(page.getByRole('button', { name: 'New workspace' })).toBeDisabled()
  })

  test('the board explains itself before the projection exists', async ({ page }) => {
    await page.goto('/#/board/produto/board')
    // No PostgreSQL in the demo host: the board is a projection, and says so.
    await expect(page.getByText("The board needs the panel's database")).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('tab', { name: 'Backlog' }).click()
    await expect(page).toHaveURL(/#\/board\/produto\/backlog$/)
    await expect(page).toHaveTitle('Backlog · produto · Dev Gateway')
  })

  test('a filtered board is a link somebody can paste', async ({ page }) => {
    await page.goto('/#/board/produto/board?priority=urgent&repository=acme%2Fapi')
    await expect(page.getByLabel('Priority')).toHaveValue('urgent')
    await page.reload()
    await expect(page.getByLabel('Priority')).toHaveValue('urgent')
  })

  test('the favicon is a built local SVG', async ({ request }) => {
    const response = await request.get('/favicon.svg')
    expect(response.ok()).toBe(true)
    expect(response.headers()['content-type']).toContain('image/svg+xml')
    expect(await response.text()).toContain('<svg')
  })

  test('the sidebar remembers its width without changing mobile navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/#/overview')

    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(page.getByRole('complementary')).toHaveAttribute('data-collapsed', 'true')
    await expect(page.getByRole('button', { name: 'Projects' })).toHaveAttribute('title', 'Projects')

    await page.reload()
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')

    await page.setViewportSize({ width: 375, height: 700 })
    await expect(page.getByRole('button', { name: 'Projects' })).toContainText('Projects')
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeHidden()
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
    const web = page.getByRole('group', { name: 'web service' })
    await expect(web.getByRole('button', { name: 'web', exact: true })).toBeVisible()
    await expect(web).toContainText('http://alpha-web.localhost')
    await expect(web).toContainText('http://alpha-preview.localhost')
    await expect(web.getByRole('link', { name: 'Open' })).toHaveCount(2)

    const postgres = page.getByRole('group', { name: 'postgres service' })
    await expect(postgres.getByRole('button', { name: 'postgres', exact: true })).toBeVisible()
    await expect(postgres.getByRole('link', { name: 'Access page' })).toBeVisible()
  })

  test('a project has a page of its own, with deep-linkable tabs', async ({ page }) => {
    await page.goto('/#/projects')
    await page.getByRole('link', { name: 'alpha', exact: true }).click()
    await expect(page).toHaveURL(/#\/projects\/alpha$/)
    await expect(page).toHaveTitle('alpha · Dev Gateway')
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('tab', { name: 'Git' }).click()
    await expect(page).toHaveURL(/#\/projects\/alpha\/git$/)
    await expect(page).toHaveTitle('Git · alpha · Dev Gateway')

    await page.reload()
    await expect(page.getByRole('tab', { name: 'Git' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Projects' })).toHaveAttribute('aria-current', 'page')

    await page.goBack()
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  })

  test('the Logs tab reads every service at once and narrows to one', async ({ page }) => {
    await page.goto('/#/projects/alpha/logs')
    const output = page.locator('pre')
    await expect(output).toBeVisible()

    const origins = await page.locator('pre span').filter({ hasText: '|' }).allTextContents()
    const services = new Set(origins.map((origin) => origin.replace('|', '').trim()))
    expect(services.size).toBeGreaterThan(1)

    await page.getByLabel('Service').selectOption('web')
    await expect(page).toHaveURL(/#\/projects\/alpha\/logs\?service=web$/)
    await expect(page.getByLabel('Service')).toHaveValue('web')

    await page.reload()
    await expect(page.getByLabel('Service')).toHaveValue('web')
  })

  test('a project can be named from the panel without a database', async ({ page }) => {
    await page.goto('/#/projects/alpha')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByText(/Nothing is written inside the project/)).toBeVisible()
    // No PostgreSQL in the demo host: the dialog says so rather than pretending.
    await expect(page.getByText('panel persistence is unavailable')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('an unknown project says so instead of failing', async ({ page }) => {
    await page.goto('/#/projects/ghost')
    await expect(page.getByText("No project 'ghost' is running")).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to all projects' })).toBeVisible()
  })

  test('the project page never makes the page scroll sideways', async ({ page }) => {
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/#/projects/alpha/services')
      await expect(page.getByRole('heading', { name: 'alpha' })).toBeVisible()
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflows, `${width}px viewport`).toBe(false)
    }
  })

  test('project service rows never make the page scroll sideways', async ({ page }) => {
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/#/projects')
      await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflows, `${width}px viewport`).toBe(false)
    }
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
    await page.goto('/#/settings/vpn')

    const token = page.getByLabel('Tailscale auth key')
    await expect(token).toHaveAttribute('type', 'password')
    await expect(token).toHaveValue('')
    await expect(page.locator('body')).not.toContainText('fixture-value-never-returned')
  })

  test('settings groups remain deep-linkable in the mobile navigation strip', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await page.goto('/#/settings/public-access')

    await expect(page).toHaveTitle('Public access · Settings · Dev Gateway')
    await expect(page.getByRole('link', { name: 'Public access' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const nav = page.getByRole('navigation', { name: 'Settings groups' })
    expect(await nav.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false)
  })

  test('settings keep one draft while moving between deep-linked groups', async ({ page, request }) => {
    try {
      await page.goto('/#/settings/gateway')
      await expect(page).toHaveTitle('Gateway · Settings · Dev Gateway')
      await page.getByLabel('Local domain').fill('e2e.localhost')

      await page.getByRole('link', { name: 'TLS' }).click()
      await expect(page).toHaveURL(/#\/settings\/tls$/)
      await page.getByLabel('HTTPS').click()
      await expect(page.getByRole('link', { name: 'Gateway, 1 unsaved' })).toBeVisible()
      await expect(page.getByText('2 unsaved')).toBeVisible()

      const patch = page.waitForRequest(
        (candidate) => candidate.url().endsWith('/api/config') && candidate.method() === 'PATCH',
      )
      await page.getByRole('button', { name: 'Save' }).click()
      expect((await patch).postDataJSON()).toEqual({
        values: { DEV_GATEWAY_DOMAIN: 'e2e.localhost', TLS_ENABLED: 'true' },
      })

      await page.getByRole('link', { name: 'Gateway' }).click()
      await expect(page.getByLabel('Local domain')).toHaveValue('e2e.localhost')
      await page.reload()
      await expect(page.getByLabel('Local domain')).toHaveValue('e2e.localhost')
    } finally {
      await request.patch('/api/config', {
        data: { values: { DEV_GATEWAY_DOMAIN: 'localhost', TLS_ENABLED: 'false' } },
      })
    }
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
