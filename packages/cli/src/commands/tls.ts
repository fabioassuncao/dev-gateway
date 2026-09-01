import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { gatewayContext } from '../context.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'

function globals(command: Command) { return command.optsWithGlobals() as { json?: boolean; yes?: boolean; quiet?: boolean; verbose?: boolean; profile?: string } }

export async function tlsStatus(command: Command): Promise<void> {
  const global = globals(command)
  const context = gatewayContext({ profile: global.profile })
  const certificate = join(context.root, 'config/tls/wildcard.crt')
  const authority = join(context.root, 'config/tls/dev-gateway-ca.crt')
  let expires: string | null = null
  let names: string[] = []
  if (existsSync(certificate)) {
    const end = await runProcess('openssl', ['x509', '-in', certificate, '-noout', '-enddate'], { reject: false })
    if (end.exitCode === 0) expires = end.stdout.replace(/^notAfter=/, '')
    const sans = await runProcess('openssl', ['x509', '-in', certificate, '-noout', '-ext', 'subjectAltName'], { reject: false })
    if (sans.exitCode === 0) names = [...sans.stdout.matchAll(/DNS:([^,\s]+)/g)].map((match) => match[1]!)
  }
  const value = { enabled: context.config.tlsEnabled, mode: context.config.tlsMode, domain: context.config.domain, certificate: { present: existsSync(certificate), path: certificate, expires, names }, authority: { present: existsSync(authority), path: authority }, acme: context.config.tlsMode === 'acme' ? { emailSet: Boolean(context.env['ACME_EMAIL']), directory: context.env['ACME_CA_SERVER'], provider: context.env['ACME_DNS_PROVIDER'] } : null }
  const output = new Output(global)
  if (output.json) output.data(value)
  else { output.line(`enabled: ${value.enabled}\nmode: ${value.mode}\ndomain: ${value.domain}\ncertificate: ${value.certificate.present ? value.certificate.path : 'absent'}`); if (expires) output.line(`expires: ${expires}`) }
}
