import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Boxes,
  Briefcase,
  Container,
  Globe,
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

interface NavItem {
  path: string
  label: string
  icon: ComponentType<{ className?: string }>
}

const NAV: NavItem[] = [
  { path: '/overview', label: 'Overview', icon: LayoutDashboard },
  { path: '/workspaces', label: 'Workspaces', icon: Briefcase },
  { path: '/projects', label: 'Projects', icon: Boxes },
  { path: '/services', label: 'Services', icon: Container },
  { path: '/docker', label: 'Docker', icon: Activity },
  { path: '/network', label: 'Network', icon: Network },
  { path: '/access', label: 'Access', icon: PlugZap },
  { path: '/gateway', label: 'Gateway', icon: Globe },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
]

export function App() {
  const [path, go] = useRoute()
  const [theme, toggleTheme] = useTheme()
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed()
  const live = useLive()
  const status = useQuery({ queryKey: ['status'], queryFn: api.overview })

  // The board belongs to a workspace, so the sidebar keeps Workspaces marked
  // while you are on one rather than highlighting nothing.
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
            title={gateway?.up ? 'Gateway up' : 'Gateway down'}
          />
          <div className={cn('min-w-0', sidebarCollapsed && 'md:hidden')}>
            <div className="text-sm font-semibold tracking-tight">Dev Gateway</div>
            <div className="truncate font-mono text-[11px] text-subtle">
              {gateway ? `${gateway.gatewayVersion} · ${gateway.profile}` : '…'}
            </div>
          </div>
        </div>

        <nav
          id="section-navigation"
          aria-label="Sections"
          className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible scroll-thin"
        >
          {NAV.map((item) => {
            const Icon = item.icon
            const active = root === item.path
            return (
              <button
                key={item.path}
                onClick={() => go(item.path)}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                title={item.label}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors',
                  sidebarCollapsed && 'md:justify-center md:px-0',
                  active ? 'bg-accent/12 font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={cn(sidebarCollapsed && 'md:sr-only')}>{item.label}</span>
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
            title="Live updates come from Docker events"
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                live.state === 'live' ? 'bg-ok' : live.state === 'connecting' ? 'bg-warn' : 'bg-danger',
              )}
            />
            <span className={cn(sidebarCollapsed && 'md:sr-only')}>{live.state}</span>
          </span>
          <div className={cn('flex items-center gap-1', sidebarCollapsed && 'md:flex-col')}>
            <button
              onClick={toggleTheme}
              className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-ink"
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={toggleSidebar}
              className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-ink"
              aria-controls="section-navigation"
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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

/** Board filters live in the hash, so a filtered board is a link to paste. */
function boardFilters(path: string): Record<string, string> {
  const start = path.indexOf('?')
  if (start < 0) return {}
  return Object.fromEntries(new URLSearchParams(path.slice(start + 1)))
}

function Page({ path, readOnly = false }: { path: string; readOnly?: boolean }) {
  const parts = segments(path)
  switch (parts[0]) {
    case 'projects':
      // #/projects/:project[/:tab] is a page of its own; the list keeps the
      // bare path. Segments arrive percent-encoded, so decode before matching.
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
