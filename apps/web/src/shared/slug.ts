// Mirrors dg_slug in scripts/lib/common.sh, which itself mirrors Traefik's
// `normalize`. A hostname the panel prints has to be the one Traefik serves.

export function slug(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '')
}
