import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Boxes,
  Briefcase,
  Container,
  Globe,
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
import { useRoute, segments, queryParam } from './lib/router.ts'
import { useTheme } from './lib/theme.ts'
import { useLive } from './lib/live.ts'
import { useSidebarCollapsed } from './lib/sidebar.ts'
import { api } from './lib/api.ts'
import { cn } from './lib/utils.ts'
import { useLocale, type Locale } from './i18n/use-locale.ts'
import { Menu, MenuContent, MenuItem, MenuTrigger } from './components/ui/menu.tsx'
import { Overview } from './pages/Overview.tsx'
import { Projects } from './pages/Projects.tsx'
import { ProjectPage } from './pages/Project.tsx'
import { Workspaces } from './pages/Workspaces.tsx'
import { WorkspacePage } from './pages/Workspace.tsx'
import { BoardPage } from './pages/Board.tsx'
import { Services } from './pages/Services.tsx'
import { DockerPage } from './pages/Docker.tsx'
import { NetworkPage } from './pages/Network.tsx'
import { Access } from './pages/Access.tsx'
import { Gateway } from './pages/Gateway.tsx'
import { Settings } from './pages/Settings.tsx'

type NavLabelKey =
  | 'overview'
  | 'workspaces'
  | 'projects'
  | 'services'
  | 'docker'
  | 'network'
  | 'access'
  | 'gateway'
  | 'settings'

interface NavItem {
  path: string
  labelKey: NavLabelKey
  icon: ComponentType<{ className?: string }>
}

const NAV: NavItem[] = [
  { path: '/overview', labelKey: 'overview', icon: LayoutDashboard },
  { path: '/workspaces', labelKey: 'workspaces', icon: Briefcase },
  { path: '/projects', labelKey: 'projects', icon: Boxes },
  { path: '/services', labelKey: 'services', icon: Container },
  { path: '/docker', labelKey: 'docker', icon: Activity },
  { path: '/network', labelKey: 'network', icon: Network },
  { path: '/access', labelKey: 'access', icon: PlugZap },
  { path: '/gateway', labelKey: 'gateway', icon: Globe },
  { path: '/settings', labelKey: 'settings', icon: SettingsIcon },
]

export function App() {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const [locale, setLocale] = useLocale()
  const [path, go] = useRoute()
  const [theme, toggleTheme] = useTheme()
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed()
  const live = useLive()
  const status = useQuery({ queryKey: ['status'], queryFn: api.overview })

  const first = segments(path)[0] ?? 'overview'
  const root = `/${first === 'board' ? 'workspaces' : first}`
  const gateway = status.data?.gateway

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside
        data-collapsed={sidebarCollapsed}
        className={cn(
          'flex shrink-0 flex-col border-b border-line bg-surface transition-[width] duration-200 md:border-r md:border-b-0',
          sidebarCollapsed ? 'md:w-14' : 'md:w-52',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 px-4 py-3.5',
            sidebarCollapsed && 'md:justify-center md:px-0',
          )}
        >
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              gateway?.up ? 'bg-ok' : status.isPending ? 'bg-subtle' : 'bg-danger',
            )}
            title={gateway?.up ? t('gatewayUp') : t('gatewayDown')}
          />
          <div className={cn('min-w-0', sidebarCollapsed && 'md:hidden')}>
            <div className="text-sm font-semibold tracking-tight">{t('appName')}</div>
            <div className="truncate font-mono text-[11px] text-subtle">
              {gateway ? `${gateway.gatewayVersion} · ${gateway.profile}` : '…'}
            </div>
          </div>
        </div>

        <nav
          id="section-navigation"
          aria-label={t('sections')}
          className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible scroll-thin"
        >
          {NAV.map((item) => {
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
        </nav>

        <div
          className={cn(
            'mt-auto hidden items-center justify-between gap-2 border-t border-line px-3 py-2 md:flex',
            sidebarCollapsed && 'md:flex-col md:px-2',
          )}
        >
          <span
            className="flex items-center gap-1.5 text-[11px] text-subtle"
            title={t('liveUpdatesHint')}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                live.state === 'live' ? 'bg-ok' : live.state === 'connecting' ? 'bg-warn' : 'bg-danger',
              )}
            />
            <span className={cn(sidebarCollapsed && 'md:sr-only')}>{t(`live.${live.state}`)}</span>
          </span>
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
  )
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function boardFilters(path: string): Record<string, string> {
  const start = path.indexOf('?')
  if (start < 0) return {}
  return Object.fromEntries(new URLSearchParams(path.slice(start + 1)))
}

function Page({ path, readOnly = false }: { path: string; readOnly?: boolean }) {
  const parts = segments(path)
  switch (parts[0]) {
    case 'projects':
      return parts[1]
        ? <ProjectPage project={decode(parts[1])} tab={parts[2] ?? null} service={queryParam(path, 'service')} />
        : <Projects />
    case 'workspaces':
      return parts[1] ? <WorkspacePage slug={decode(parts[1])} /> : <Workspaces />
    case 'board':
      return parts[1] ? (
        <BoardPage
          slug={decode(parts[1])}
          view={parts[2] ?? null}
          filters={boardFilters(path)}
          readOnly={readOnly}
        />
      ) : (
        <Workspaces />
      )
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
