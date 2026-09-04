import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Boxes,
  Container,
  Globe,
  BookOpen,
  Languages,
  LayoutDashboard,
  Monitor,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Search,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useRoute, segments, queryParam } from './lib/router.ts'
import { legacyRedirect } from './lib/redirects.ts'
import { useTheme, type Theme } from './lib/theme.ts'
import { useLive } from './lib/live.ts'
import { useSidebarCollapsed } from './lib/sidebar.ts'
import { useShortcut } from './lib/shortcuts.ts'
import { useMetricsCurrent, useStatus } from './lib/queries/index.ts'
import { cn } from './lib/utils.ts'
import { useLocale, type Locale } from './i18n/use-locale.ts'
import { Menu, MenuContent, MenuRadio, MenuRadioGroup, MenuTrigger } from './components/ui/menu.tsx'
import { Tooltip } from './components/ui/tooltip.tsx'
import { Kbd, MOD_KEY } from './components/ui/kbd.tsx'
import { iconButton } from './components/ui/surfaces.ts'
import { GatewayStatusDot } from './components/gateway-status-dot.tsx'
import { ConnectionBanner } from './components/connection-banner.tsx'
import { ApplyBar } from './components/apply-bar.tsx'
import { CommandPalette } from './components/command-palette.tsx'
import { Overview } from './pages/Overview.tsx'
import { Projects } from './pages/Projects.tsx'
import { ProjectPage } from './pages/Project.tsx'
import { EnvironmentPage } from './pages/Environment.tsx'
import { EnvironmentsPage } from './pages/Environments.tsx'
import { RepositoryPage } from './pages/Repository.tsx'
import { Loading } from './components/shell-bits.tsx'
import { TaskPage } from './pages/Task.tsx'
import { Services } from './pages/Services.tsx'
import { DockerPage } from './pages/Docker.tsx'
import { NetworkPage } from './pages/Network.tsx'
import { Access } from './pages/Access.tsx'
import { Gateway } from './pages/Gateway.tsx'
import { Settings } from './pages/Settings.tsx'
import { navigate } from './lib/router.ts'

type NavLabelKey =
  | 'overview'
  | 'projects'
  | 'services'
  | 'docker'
  | 'network'
  | 'access'
  | 'gateway'
  | 'settings'

type NavGroupKey = 'groups.development' | 'groups.infrastructure'

interface NavItem {
  path: string
  labelKey: NavLabelKey
  icon: ComponentType<{ className?: string }>
}

interface NavGroup {
  /** Null for the trailing items that belong to no group. */
  labelKey: NavGroupKey | null
  items: NavItem[]
}

/**
 * Two groups and a tail. Development is where a day starts; infrastructure
 * is the set of technical perspectives over the same host. Settings sits
 * alone at the end because it is neither.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'groups.development',
    items: [
      { path: '/overview', labelKey: 'overview', icon: LayoutDashboard },
      { path: '/projects', labelKey: 'projects', icon: Boxes },
    ],
  },
  {
    labelKey: 'groups.infrastructure',
    items: [
      { path: '/services', labelKey: 'services', icon: Container },
      { path: '/docker', labelKey: 'docker', icon: Activity },
      { path: '/network', labelKey: 'network', icon: Network },
      { path: '/access', labelKey: 'access', icon: PlugZap },
      { path: '/gateway', labelKey: 'gateway', icon: Globe },
    ],
  },
  {
    labelKey: null,
    items: [{ path: '/settings', labelKey: 'settings', icon: SettingsIcon }],
  },
]

/** Which sidebar item a first path segment belongs to, when it is not its own. */
const ROOT_OF: Record<string, string> = {
  environments: '/projects',
}

/**
 * The mark. Three bars of decreasing height inside a rounded square: a port,
 * and the panel's own shorthand for a host with things running on it. Small on
 * purpose — it identifies the product, it does not decorate the page.
 */
function Brand() {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg"
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
        <path d="M4 11.5V6" />
        <path d="M8 11.5V3.5" />
        <path d="M12 11.5V8" />
      </svg>
    </span>
  )
}

const THEME_ICON: Record<Theme, ComponentType<{ className?: string }>> = { light: Sun, dark: Moon, system: Monitor }

/**
 * The controls that belong to the panel rather than to a page: language,
 * theme, the documentation, the sidebar. Small icon buttons, because they
 * are used once a week and looked at all day.
 */
function ShellControls({
  theme,
  setTheme,
  locale,
  setLocale,
  docs,
  collapsed,
  toggleSidebar,
  vertical,
}: {
  theme: Theme
  setTheme: (theme: Theme) => void
  locale: Locale
  setLocale: (locale: Locale) => void
  docs: boolean
  collapsed: boolean
  toggleSidebar: () => void
  vertical: boolean
}) {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const ThemeIcon = THEME_ICON[theme]
  return (
    <div className={cn('flex items-center gap-0.5', vertical && 'md:flex-col')}>
      <Menu>
        <Tooltip label={tc('languageSelectorTitle')}>
          <MenuTrigger className={iconButton} aria-label={tc('languageSelector')}>
            <Languages />
          </MenuTrigger>
        </Tooltip>
        <MenuContent align={vertical ? 'start' : 'end'} side={vertical ? 'right' : 'bottom'}>
          <MenuRadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            <MenuRadio value="en">{tc('english')}</MenuRadio>
            <MenuRadio value="pt-BR">{tc('portuguese')}</MenuRadio>
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      <Menu>
        <Tooltip label={t('theme.label')}>
          <MenuTrigger className={iconButton} aria-label={t('toggleTheme')}>
            <ThemeIcon />
          </MenuTrigger>
        </Tooltip>
        <MenuContent align={vertical ? 'start' : 'end'} side={vertical ? 'right' : 'bottom'}>
          <MenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
            <MenuRadio value="light" icon={<Sun />}>{t('theme.light')}</MenuRadio>
            <MenuRadio value="dark" icon={<Moon />}>{t('theme.dark')}</MenuRadio>
            <MenuRadio value="system" icon={<Monitor />}>{t('theme.system')}</MenuRadio>
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      {docs ? (
        <Tooltip label={t('documentation')}>
          <a href="/docs/" target="_blank" rel="noreferrer" className={iconButton} aria-label={t('documentation')}>
            <BookOpen />
          </a>
        </Tooltip>
      ) : null}
      <Tooltip label={collapsed ? t('expandSidebar') : t('collapseSidebar')} shortcut={['[']}>
        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(iconButton, 'hidden md:inline-flex')}
          aria-controls="section-navigation"
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </Tooltip>
    </div>
  )
}

export function App() {
  const { t } = useTranslation('nav')
  const [locale, setLocale] = useLocale()
  const [path] = useRoute()
  const { theme, setTheme } = useTheme()
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const live = useLive()
  const status = useStatus()
  const metrics = useMetricsCurrent()

  const parts = segments(path)
  const first = parts[0] ?? 'overview'
  const root = ROOT_OF[first] ?? `/${first}`
  const gateway = status.data?.gateway
  const projectSlug = first === 'projects' && parts[1] ? decode(parts[1]) : null

  const gatewayTitle = gateway?.up ? t('gatewayUp') : t('gatewayDown')
  const hostname = metrics.data?.host?.hostname ?? metrics.data?.instance.hostname ?? null
  const hostLine = gateway
    ? [hostname, gateway.gatewayVersion, gateway.profile].filter(Boolean).join(' · ')
    : '…'

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  useShortcut({ key: 'k', mod: true }, openPalette)
  useShortcut({ key: '[' }, toggleSidebar)

  const controls = (vertical: boolean) => (
    <ShellControls
      theme={theme}
      setTheme={setTheme}
      locale={locale}
      setLocale={setLocale}
      docs={Boolean(status.data?.gateway.panel.docs)}
      collapsed={sidebarCollapsed}
      toggleSidebar={toggleSidebar}
      vertical={vertical}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <ConnectionBanner state={live.state} />
      <ApplyBar readOnly={gateway?.panel.readOnly ?? false} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          data-collapsed={sidebarCollapsed}
          className={cn(
            'flex shrink-0 flex-wrap items-center transition-[width] duration-150 md:h-full md:flex-col md:flex-nowrap md:items-stretch',
            sidebarCollapsed ? 'md:w-12' : 'md:w-56',
          )}
        >
          <div
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 px-3 pt-2.5 pb-1.5 md:flex-none md:pt-3',
              sidebarCollapsed && 'md:justify-center md:px-0',
            )}
          >
            <Brand />
            <div className={cn('min-w-0 flex-1', sidebarCollapsed && 'md:hidden')}>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-ink">{t('appName')}</span>
                <GatewayStatusDot up={gateway?.up} pending={status.isPending} title={gatewayTitle} />
              </div>
              {/* What this panel is attached to, which is the one thing a person
                  with two of them open needs to tell them apart. */}
              <div className="truncate text-2xs text-subtle" title={hostLine}>
                {hostLine}
              </div>
            </div>
          </div>

          <div className={cn('order-2 w-full px-2 pb-1 md:order-none', sidebarCollapsed && 'md:px-1.5')}>
            <Tooltip label={t('commandPalette')} shortcut={['mod', 'K']}>
              <button
                type="button"
                onClick={openPalette}
                aria-label={t('commandPalette')}
                className={cn(
                  'flex h-7 w-full items-center gap-2 rounded-md border border-line bg-surface px-2 text-xs text-subtle',
                  'transition-colors duration-100 hover:border-line-strong hover:text-muted focus-ring',
                  sidebarCollapsed && 'md:justify-center md:px-0',
                )}
              >
                <Search className="size-3.5 shrink-0" aria-hidden />
                <span className={cn('flex-1 truncate text-left', sidebarCollapsed && 'md:sr-only')}>{t('commandPalette')}</span>
                <span className={cn('flex items-center gap-0.5', sidebarCollapsed && 'md:hidden')} aria-hidden>
                  <Kbd>{MOD_KEY}</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </button>
            </Tooltip>
          </div>

          <nav
            id="section-navigation"
            aria-label={t('sections')}
            className={cn('order-3 flex w-full gap-1 overflow-x-auto px-2 py-1 md:order-none md:flex-col md:overflow-visible scroll-thin', sidebarCollapsed && 'md:px-1.5')}
          >
            {NAV_GROUPS.map((group, index) => (
              <div
                key={group.labelKey ?? 'tail'}
                className={cn('flex gap-0.5 md:flex-col', index > 0 && 'md:mt-3')}
                role="group"
                aria-label={group.labelKey ? t(group.labelKey) : undefined}
              >
                {group.labelKey ? (
                  <div
                    aria-hidden="true"
                    className={cn('hidden px-2 pb-1 text-2xs font-medium text-subtle md:block', sidebarCollapsed && 'md:hidden')}
                  >
                    {t(group.labelKey)}
                  </div>
                ) : null}
                {group.items.map((item) => {
                  const Icon = item.icon
                  const active = root === item.path
                  const label = t(item.labelKey)
                  const link = (
                    <a
                      key={item.path}
                      href={`#${item.path}`}
                      aria-current={active ? 'page' : undefined}
                      aria-label={sidebarCollapsed ? label : undefined}
                      title={sidebarCollapsed ? label : undefined}
                      className={cn(
                        'flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-sm font-medium whitespace-nowrap',
                        'transition-colors duration-100 focus-ring',
                        sidebarCollapsed && 'md:justify-center md:px-0',
                        active ? 'bg-fill-strong text-ink' : 'text-muted hover:bg-fill hover:text-ink',
                      )}
                    >
                      <Icon className={cn('size-4 shrink-0', active ? 'text-ink' : 'text-subtle')} />
                      <span className={cn(sidebarCollapsed && 'md:sr-only')}>{label}</span>
                    </a>
                  )
                  return sidebarCollapsed ? (
                    <Tooltip key={item.path} label={label} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )
                })}
              </div>
            ))}
          </nav>

          {/* On a phone the controls sit beside the brand, on the first row;
              on a desktop they wait at the bottom of the rail. One set of
              controls either way, moved by order rather than duplicated. */}
          <div
            className={cn(
              'order-1 flex items-center px-2 pt-2 pb-1.5 md:order-none md:mt-auto md:py-2',
              sidebarCollapsed ? 'md:justify-center md:px-1.5' : 'md:justify-end',
            )}
          >
            {controls(sidebarCollapsed)}
          </div>
        </aside>

        {/* min-w-0: a flex item will not shrink below its content without it,
            which is what let a wide table push the whole page sideways instead
            of scrolling inside its own container. The main column is a panel
            of its own: a hairline and a lift above the canvas the sidebar
            sits on, so the content is what the eye lands on. */}
        <main
          className={cn(
            'min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface scroll-thin',
            'border-t border-line md:mr-2 md:mb-2 md:rounded-lg md:border',
          )}
        >
          <div className="mx-auto max-w-[88rem] px-4 py-4 md:px-6 md:py-5">
            <Page path={path} readOnly={gateway?.panel.readOnly ?? false} />
          </div>
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        projectSlug={projectSlug}
        theme={theme}
        setTheme={setTheme}
        locale={locale}
        setLocale={setLocale}
        toggleSidebar={toggleSidebar}
      />
    </div>
  )
}

function queryOf(path: string): string {
  const start = path.indexOf('?')
  return start < 0 ? '' : path.slice(start)
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function Page({ path, readOnly = false }: { path: string; readOnly?: boolean }) {
  const legacy = legacyRedirect(path)
  if (legacy) return <Redirect to={legacy} />

  const parts = segments(path)
  switch (parts[0]) {
    case 'projects':
      if (!parts[1]) return <Projects />
      if (parts[2] === 'repositories' && parts[3]) {
        return <RepositoryPage slug={decode(parts[1])} id={decode(parts[3])} tab={parts[4] ?? null} />
      }
      if (parts[2] === 'tasks' && parts[3]) {
        return <TaskPage slug={decode(parts[1])} id={decode(parts[3])} readOnly={readOnly} />
      }
      return <ProjectPage slug={decode(parts[1])} tab={parts[2] ?? null} query={queryOf(path)} readOnly={readOnly} />
    case 'environments':
      return parts[1]
        ? <EnvironmentPage project={decode(parts[1])} tab={parts[2] ?? null} service={queryParam(path, 'service')} />
        : <EnvironmentsPage />
    case 'services':
      return <Services />
    case 'docker':
      return <DockerPage />
    case 'network':
      return <NetworkPage />
    case 'access':
      return <Access />
    case 'gateway':
      return <Gateway />
    case 'settings':
      return <Settings group={parts[1] ?? null} />
    default:
      return <Overview />
  }
}

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to)
  }, [to])
  return <Loading />
}
