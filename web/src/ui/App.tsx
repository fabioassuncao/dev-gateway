import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Boxes,
  Container,
  Globe,
  LayoutDashboard,
  Moon,
  Network,
  PlugZap,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useRoute, segments } from './lib/router.ts'
import { useTheme } from './lib/theme.ts'
import { useLive } from './lib/live.ts'
import { api } from './lib/api.ts'
import { cn } from './lib/utils.ts'
import { Overview } from './pages/Overview.tsx'
import { Projects } from './pages/Projects.tsx'
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
  const live = useLive()
  const status = useQuery({ queryKey: ['status'], queryFn: api.overview })

  const root = `/${segments(path)[0] ?? 'overview'}`
  const gateway = status.data?.gateway

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line bg-surface md:w-52 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-3.5">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              gateway?.up ? 'bg-ok' : status.isPending ? 'bg-subtle' : 'bg-danger',
            )}
            title={gateway?.up ? 'Gateway up' : 'Gateway down'}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight">Dev Gateway</div>
            <div className="truncate font-mono text-[11px] text-subtle">
              {gateway ? `${gateway.gatewayVersion} · ${gateway.profile}` : '…'}
            </div>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible scroll-thin">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = root === item.path
            return (
              <button
                key={item.path}
                onClick={() => go(item.path)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors',
                  active ? 'bg-accent/12 font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="mt-auto hidden items-center justify-between gap-2 border-t border-line px-3 py-2 md:flex">
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
            {live.state}
          </span>
          <button
            onClick={toggleTheme}
            className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-ink"
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6 scroll-thin">
        <div className="mx-auto max-w-[1400px]">
          <Page path={path} />
        </div>
      </main>
    </div>
  )
}

function Page({ path }: { path: string }) {
  const parts = segments(path)
  switch (parts[0]) {
    case 'projects':
      return <Projects selected={parts[1] ?? null} />
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
      return <Settings />
    default:
      return <Overview />
  }
}
