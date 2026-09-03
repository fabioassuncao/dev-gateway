import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Boxes,
  Container,
  Globe,
  BookOpen,
  Languages,
  LayoutDashboard,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useRoute, segments, queryParam, navigate } from './lib/router.ts'
import { legacyRedirect } from './lib/redirects.ts'
import { useTheme } from './lib/theme.ts'
import { useLive } from './lib/live.ts'
import { useSidebarCollapsed } from './lib/sidebar.ts'
import { useStatus } from './lib/queries/index.ts'
import { cn } from './lib/utils.ts'
import { useLocale, type Locale } from './i18n/use-locale.ts'
import { Menu, MenuContent, MenuItem, MenuTrigger } from './components/ui/menu.tsx'
import { GatewayStatusDot } from './components/gateway-status-dot.tsx'
import { ConnectionBanner } from './components/connection-banner.tsx'
import { ApplyBar } from './components/apply-bar.tsx'
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

export function App() {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const [locale, setLocale] = useLocale()
  const [path, go] = useRoute()
  const [theme, toggleTheme] = useTheme()
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed()
  const live = useLive()
  const status = useStatus()

  const first = segments(path)[0] ?? 'overview'
  const root = ROOT_OF[first] ?? `/${first}`
  const gateway = status.data?.gateway

  const gatewayTitle = gateway?.up ? t('gatewayUp') : t('gatewayDown')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConnectionBanner state={live.state} />
      <ApplyBar readOnly={gateway?.panel.readOnly ?? false} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside
        data-collapsed={sidebarCollapsed}
        className={cn(
          'flex shrink-0 flex-col border-b border-line bg-surface transition-[width] duration-200 md:border-r md:border-b-0',
          sidebarCollapsed ? 'md:w-14' : 'md:w-52',
        )}
      >
        <div
          className={cn(
            'flex items-center justify-between gap-2 px-4 py-3.5',
            sidebarCollapsed && 'md:justify-center md:px-0',
          )}
        >
          <div className={cn('min-w-0', sidebarCollapsed && 'md:hidden')}>
            <div className="text-sm font-semibold tracking-tight">{t('appName')}</div>
            <div className="truncate font-mono text-[11px] text-subtle">
              {gateway ? `${gateway.gatewayVersion} · ${gateway.profile}` : '…'}
            </div>
          </div>
          <GatewayStatusDot
            up={gateway?.up}
            pending={status.isPending}
            title={gatewayTitle}
          />
        </div>

        <nav
          id="section-navigation"
          aria-label={t('sections')}
          className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible scroll-thin"
        >
          {NAV_GROUPS.map((group, index) => (
            <div
              key={group.labelKey ?? 'tail'}
              className={cn('flex gap-1 md:flex-col', index > 0 && 'md:mt-2')}
              role="group"
              aria-label={group.labelKey ? t(group.labelKey) : undefined}
            >
              {group.labelKey ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    'hidden px-2.5 pt-1 pb-0.5 text-[10px] font-semibold tracking-wider text-subtle uppercase md:block',
                    sidebarCollapsed && 'md:hidden',
                  )}
                >
                  {t(group.labelKey)}
                </div>
              ) : null}
              {group.items.map((item) => {
                const Icon = item.icon
                const active = root === item.path
                const label = t(item.labelKey)
                return (
                  <button
                    key={item.path}
                    onClick={() => go(item.path)}
                    aria-label={label}
                    aria-current={active ? 'page' : undefined}
                    title={label}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors',
                      sidebarCollapsed && 'md:justify-center md:px-0',
                      active ? 'bg-accent/12 font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className={cn(sidebarCollapsed && 'md:sr-only')}>{label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div
          className={cn(
            'mt-auto hidden items-center justify-end gap-2 border-t border-line px-3 py-2 md:flex',
            sidebarCollapsed && 'md:flex-col md:px-2',
          )}
        >
          <div className={cn('flex items-center gap-1', sidebarCollapsed && 'md:flex-col')}>
            <Menu>
              <MenuTrigger
                className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-ink"
                aria-label={tc('languageSelector')}
                title={tc('languageSelectorTitle')}
              >
                <Languages className="h-3.5 w-3.5" />
              </MenuTrigger>
              <MenuContent align={sidebarCollapsed ? 'start' : 'end'}>
                {(['en', 'pt-BR'] as Locale[]).map((option) => (
                  <MenuItem key={option} onSelect={() => setLocale(option)}>
                    {option === 'pt-BR' ? tc('portuguese') : tc('english')}
                    {locale === option ? ' ✓' : ''}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            {status.data?.gateway.panel.docs && (
              <a
                href="/docs/"
                target="_blank"
                rel="noreferrer"
                className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-ink"
                aria-label={t('documentation')}
                title={t('documentation')}
              >
                <BookOpen className="h-3.5 w-3.5" />
              </a>
            )}
            <button
              onClick={toggleTheme}
              className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-ink"
              aria-label={t('toggleTheme')}
              title={t('toggleTheme')}
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={toggleSidebar}
              className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-ink"
              aria-controls="section-navigation"
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
              title={sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftClose className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6 scroll-thin">
        <div className="mx-auto max-w-[1400px]">
          <Page path={path} readOnly={gateway?.panel.readOnly ?? false} />
        </div>
      </main>
      </div>
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
