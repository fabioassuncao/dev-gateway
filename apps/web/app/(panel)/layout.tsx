import type { ReactNode } from 'react'
import { Shell } from '@/components/shell/shell'

/**
 * Every panel page is rendered inside the shell.
 *
 * A Server Component that renders one client boundary: the shell is
 * interactive — a palette, a theme menu, a live connection — and the pages
 * inside it are not, so the boundary sits here rather than around each page.
 *
 * Authentication will be checked in this layout, once there is any: it is the
 * one entrance every page comes through.
 */
export default function PanelLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>
}
