import { Command, CommanderError } from 'commander'
import { CliError, EXIT } from './errors.js'
import { Output } from './output.js'
import { accessClose, accessGc, accessInspect, accessList, accessOpen, serviceList, servicePublish, serviceUnpublish } from './commands/access.js'
import { dbDump, dbOpen, dbRestore, dbShell, dbStatus, dbUrl, clientClose, clientExec, redisOpen } from './commands/clients.js'
import { analyzeCommand, initCommand, namespaceCommand, projectList, projectShow, servicesCommand } from './commands/projects.js'
import { bootstrapCommand, devCommand, doctorCommand, downCommand, inspectCommand, logsCommand, restartCommand, statusCommand, updateCommand, upCommand, urlsCommand, versionCommand } from './commands/lifecycle.js'
import { dnsCheck, dnsSetup, dnsStatus, networkStatus, publicDisable, publicEnable, publicStatus } from './commands/network.js'
import { gitClear, gitScan, gitStatus } from './commands/git.js'
import { configGet, configList, configSet } from './commands/config.js'
import { setupCommand } from './commands/setup.js'
import { authProtect, authStatus, authUnprotect } from './commands/auth.js'
import { shareGc, shareList, shareRevoke } from './commands/share.js'
import { tlsInit, tlsStatus, tlsTrust, tlsUntrust } from './commands/tls.js'
import { backupCommand, repairCommand, restoreCommand } from './commands/maintenance.js'
import { mcpCommand } from './commands/mcp.js'
import { remoteAccessClose, remoteAccessList, remoteAccessOpen, remoteBootstrap, remoteExec, remoteGateway } from './commands/remote.js'
import { tunnelDisable, tunnelEnable, tunnelLogs, tunnelSetup, tunnelStatus, tunnelTest } from './commands/tunnel.js'
import { legacy, webAuthApply, webAuthClear, webAuthSet, webAuthStatus, webBuild, webDisable, webDown, webLogs, webOpen, webRestart, webStatus, webUp } from './commands/web.js'
import { CLI_VERSION } from './version.js'

const VERSION = CLI_VERSION

function describe(command: Command, description: string): Command {
  return command.description(description).showHelpAfterError('(run with --help for usage)')
}

function projectOption(command: Command): Command { return command.requiredOption('--project <name>', 'Compose project name') }
function serviceOption(command: Command, fallback?: string): Command {
  return fallback ? command.option('--service <name>', 'Compose service name', fallback) : command.requiredOption('--service <name>', 'Compose service name')
}

const program = new Command()
program
  .name('portta')
  .description('Shared HTTP/TCP gateway for parallel Docker development')
  .version(`portta ${VERSION}`)
  .option('--json', 'print machine-readable data to stdout')
  .option('-y, --yes', 'confirm non-interactively')
  .option('--quiet', 'suppress progress output')
  .option('--verbose', 'print diagnostic detail to stderr')
  .option('--profile <name>', 'local, remote-private or remote-public')
  .configureOutput({ writeErr: (value) => process.stderr.write(value) })
  .exitOverride()

describe(program.command('version'), 'Print the installed version').action((_options, command) => versionCommand(command))

describe(program.command('setup'), 'Provision or update a gateway checkout safely')
  .option('--dir <path>', 'gateway checkout directory')
  .option('--repo <url>', 'repository to clone')
  .option('--branch <name>', 'branch to install', 'develop')
  .option('--dry-run', 'print the idempotent plan without changing anything')
  .option('--skip-pull', 'do not pull images')
  .action(setupCommand)

describe(program.command('bootstrap'), 'Prepare this checkout and run diagnostics')
  .option('--skip-pull', 'do not pull component images')
  .action(bootstrapCommand)
describe(program.command('up [profile]'), 'Start gateway components')
  .option('--attach', 'run in the foreground')
  .action(upCommand)
describe(program.command('dev [profile]'), 'Start a checkout from local Dockerfiles, never the published images')
  .action((profile: string | undefined, _options, command) => devCommand(profile, command))
describe(program.command('down'), 'Stop gateway components; keep projects and data').action((_options, command) => downCommand(command))
describe(program.command('restart'), 'Recreate gateway components').action((_options, command) => restartCommand(command))
describe(program.command('status'), 'Show gateway status').action((_options, command) => statusCommand(command))
describe(program.command('doctor'), 'Run read-only host and gateway diagnostics').action((_options, command) => doctorCommand(command))
describe(program.command('urls'), 'List routed HTTP hostnames').option('--project <name>').action(urlsCommand)
describe(program.command('logs [service]'), 'Follow gateway component logs').option('--no-follow').option('--tail <lines>', 'line count', '200').action(logsCommand)
describe(program.command('inspect'), 'Print resolved configuration without secrets').action((_options, command) => inspectCommand(command))
describe(program.command('update'), 'Pull pinned images and recreate after confirmation').action((_options, command) => updateCommand(command))

const project = describe(program.command('project'), 'Inspect and adopt Compose projects')
describe(project.command('list'), 'List running Compose projects').action((options, command) => projectList(options, command))
describe(project.command('show <name>'), 'Show one project, its services and URLs').action((name, _options, command) => projectShow(name, command))
describe(project.command('services'), 'List services across running projects').option('--project <name>').action(servicesCommand)
describe(project.command('analyze <path>'), 'Read-only adoption report').action((path, _options, command) => analyzeCommand(path, command))
describe(project.command('init <path>'), 'Write one integration overlay after confirmation')
  .option('--dry-run').option('--service <name:port>', 'service to expose; repeatable', (value, previous: string[]) => previous.concat(value), [])
  .option('--output <file>', 'overlay filename', 'compose.portta.yaml').option('--force').action(initCommand)
describe(project.command('namespace'), 'Derive a collision-safe COMPOSE_PROJECT_NAME')
  .option('--path <dir>').option('--base <name>').option('--suffix <text>').option('--no-check').action(namespaceCommand)

describe(program.command('services'), 'Compatibility alias for project services').option('--project <name>').action(servicesCommand)
describe(program.command('analyze <path>'), 'Compatibility alias for project analyze').action((path, _options, command) => analyzeCommand(path, command))
describe(program.command('init <path>'), 'Compatibility alias for project init')
  .option('--dry-run').option('--service <name:port>', 'repeatable service', (value, previous: string[]) => previous.concat(value), [])
  .option('--output <file>', 'overlay filename', 'compose.portta.yaml').option('--force').action(initCommand)
describe(program.command('namespace'), 'Compatibility alias for project namespace')
  .alias('ns').option('--path <dir>').option('--base <name>').option('--suffix <text>').option('--no-check').action(namespaceCommand)

const access = describe(program.command('access'), 'Open short-lived loopback bridges')
describe(projectOption(serviceOption(access.command('open'))), 'Open a bridge')
  .option('--port <number>').option('--local-port <number>').option('--ttl <duration>').option('--network <name>').option('--bind <ip>', 'bind address', '127.0.0.1').action(accessOpen)
describe(access.command('list').alias('ls'), 'List bridges').action((_options, command) => accessList(command))
describe(access.command('close [id]'), 'Close only gateway-owned bridges').option('--project <name>').option('--all').action(accessClose)
describe(access.command('inspect <id>'), 'Inspect one bridge').action((id, _options, command) => accessInspect(id, command))
describe(access.command('gc'), 'Remove expired and orphaned bridges').action((_options, command) => accessGc(command))

const service = describe(program.command('service'), 'Manage persistent private TCP forwarders')
describe(projectOption(serviceOption(service.command('publish'))), 'Publish a service privately').option('--private').option('--public').option('--port <number>').option('--alias <name>').action(servicePublish)
describe(service.command('list'), 'List private forwarders').action((_options, command) => serviceList(command))
describe(service.command('unpublish [alias]'), 'Remove gateway-owned forwarders').option('--project <name>').action(serviceUnpublish)

const network = describe(program.command('network'), 'Inspect host network exposure')
describe(network.command('status'), 'List published bindings').option('--public-ip', 'make one outbound public-IP lookup').action(networkStatus)
const publicCommand = describe(program.command('public'), 'Control deliberate public HTTP exposure')
describe(publicCommand.command('status'), 'Show current public exposure').action((_options, command) => publicStatus(command))
describe(publicCommand.command('enable'), 'Enable public HTTP after confirmation').action((_options, command) => publicEnable(command))
describe(publicCommand.command('disable'), 'Disable public HTTP').action((_options, command) => publicDisable(command))
const dns = describe(program.command('dns'), 'Inspect or configure wildcard DNS')
describe(dns.command('check'), 'Resolve a wildcard probe').action((_options, command) => dnsCheck(command))
describe(dns.command('status'), 'Show DNS configuration without secrets').action((_options, command) => dnsStatus(command))
describe(dns.command('setup'), 'Plan or apply a Cloudflare wildcard record').option('--target <ip>').option('--dry-run').action(dnsSetup)

const web = describe(program.command('web'), 'Run the optional administration panel')
describe(web.command('up'), 'Enable and start the panel').option('--expose <scope>', 'local, tailscale, public or vpn').option('--port <number>').option('--read-only').option('--writable').action(webUp)
describe(web.command('dev'), 'Start the panel with hot reload').option('--expose <scope>').option('--port <number>').option('--read-only').option('--writable').action((options, command) => webUp({ ...options, dev: true }, command))
describe(web.command('down'), 'Stop the panel only').action((_options, command) => webDown(command))
describe(web.command('disable'), 'Stop and disable the panel').action((_options, command) => webDisable(command))
describe(web.command('restart'), 'Restart panel containers').action((_options, command) => webRestart(command))
describe(web.command('status'), 'Show panel state and URL').action((_options, command) => webStatus(command))
describe(web.command('open'), 'Print and open the panel URL').action((_options, command) => webOpen(command))
describe(web.command('logs [service]'), 'Follow panel logs').action((service, _options, command) => webLogs(service, command))
describe(web.command('build'), 'Build the panel image').action((_options, command) => webBuild(command))
const webAuth = describe(web.command('auth'), 'Manage the panel login credential')
describe(webAuth.command('status', { isDefault: true }), 'Show panel authentication').action((_options, command) => webAuthStatus(command))
describe(webAuth.command('set'), 'Generate or read a password and store only its hash').option('--user <name>').option('--password-stdin').action(webAuthSet)
describe(webAuth.command('clear'), 'Remove the credential while the panel is local').action((_options, command) => webAuthClear(command))
describe(webAuth.command('apply'), 'Render the middleware from .env').action((_options, command) => webAuthApply(command))

const config = describe(program.command('config'), 'Read and change settings on an installed gateway')
describe(config.command('list', { isDefault: true }).alias('ls'), 'List the named settings and their values').action((_options, command) => configList(command))
describe(config.command('get <setting>'), 'Print one setting').action((name, _options, command) => configGet(name, command))
describe(config.command('set <setting> <value>'), 'Change one setting and apply it')
  .option('--no-apply', 'write the value without recreating anything')
  .action((name, value, options, command) => configSet(name, value, options, command))

const git = describe(program.command('git'), 'Collect project Git metadata on the host')
describe(git.command('scan'), 'Collect Git state into state/git').option('--project <name>').option('--with-prs').option('--forge-ttl <seconds>').action(gitScan)
describe(git.command('status'), 'Show collected Git state and age').action((_options, command) => gitStatus(command))
describe(git.command('clear'), 'Remove collected Git files').action((_options, command) => gitClear(command))
const share = describe(program.command('share'), 'Manage panel-created temporary shares')
describe(share.command('list'), 'List shares').action((_options, command) => shareList(command))
describe(share.command('revoke <id>'), 'Revoke one share without touching its project').action((id, _options, command) => shareRevoke(id, command))
describe(share.command('gc'), 'Remove expired shares').action((_options, command) => shareGc(command))

const auth = describe(program.command('auth'), 'Manage ForwardAuth protection for project hostnames')
describe(auth.command('status [host]', { isDefault: true }), 'List protected hosts without credentials').action((host, _options, command) => authStatus(host, command))
describe(auth.command('protect <host>'), 'Create or rotate a hostname credential')
  .option('--user <name>').option('--password-stdin').option('--entrypoint <name>')
  .option('--label <text>').option('--project <name>').option('--service <name>')
  .action(authProtect)
describe(auth.command('unprotect <host>'), 'Remove a hostname credential without changing project labels').action((host, _options, command) => authUnprotect(host, command))

const db = describe(program.command('db'), 'Panel database operations and project database clients')
describe(db.command('status'), 'Show panel PostgreSQL state').action((_options, command) => dbStatus(command))
describe(db.command('shell'), 'Open an interactive panel psql').action((_options, command) => dbShell(command))
describe(db.command('dump'), 'Write a custom-format panel backup to stdout').action((_options, command) => dbDump(command))
describe(db.command('restore [file]'), 'Restore panel persistence after confirmation').action((file, _options, command) => dbRestore(file, command))
describe(projectOption(db.command('open')), 'Open a project database bridge').option('--service <name>', 'service', 'postgres').option('--port <number>').option('--local-port <number>').action(dbOpen)
describe(projectOption(db.command('close')), 'Close project database bridges').action(clientClose)
describe(projectOption(db.command('url')), 'Print a credential-free bridge URL').option('--service <name>', 'service', 'postgres').action(dbUrl)
describe(projectOption(db.command('psql')), 'Run psql inside the project network').option('--service <name>', 'service', 'postgres').option('--port <number>').option('--user <name>').option('--database <name>').argument('[args...]').action((args, options, command) => clientExec('psql', options, args, command))
describe(projectOption(db.command('mysql')), 'Run mysql inside the project network').option('--service <name>', 'service', 'mysql').option('--port <number>').option('--user <name>').option('--database <name>').argument('[args...]').action((args, options, command) => clientExec('mysql', options, args, command))
const redis = describe(program.command('redis'), 'Reach a project Redis privately')
describe(projectOption(redis.command('open')), 'Open a Redis bridge').option('--service <name>', 'service', 'redis').option('--port <number>').option('--local-port <number>').action(redisOpen)
describe(projectOption(redis.command('close')), 'Close project Redis bridges').action(clientClose)
describe(projectOption(redis.command('cli')), 'Run redis-cli inside the project network').option('--service <name>', 'service', 'redis').option('--port <number>').argument('[args...]').action((args, options, command) => clientExec('redis-cli', options, args, command))

describe(program.command('backup'), 'Archive everything this installation cannot regenerate')
  .option('-o, --output <file>', 'where to write the archive')
  .option('--no-database', 'leave the panel database out')
  .action(backupCommand)
describe(program.command('restore [file]'), 'Put a backup back, keeping what it replaced')
  .option('-f, --force', 'replace configuration under a running gateway')
  .action(restoreCommand)
describe(program.command('repair'), 'Recreate what is missing and fix what is provably wrong')
  .option('--dry-run', 'print the plan without changing anything')
  .action(repairCommand)

describe(program.command('mcp'), 'Serve the task verbs to an agent over stdio (MCP)')
  .option('--url <url>', 'the panel API base URL; defaults to the local panel')
  .option('--allow-remote', 'permit a non-loopback panel URL, which is where a credential would be sent')
  .option('--actor <name>', 'recorded on every write as X-Portta-Actor', 'agent')
  .action(mcpCommand)

const remote = describe(program.command('remote'), 'Operate a gateway on another host over SSH')
describe(remote.command('bootstrap <target>'), 'Prepare a host and start the gateway there')
  .option('--profile <name>', 'profile to configure', 'remote-private')
  .option('--dir <path>', 'where to install', 'portta')
  .option('--repo <url>', "repository to clone; defaults to this repo's origin")
  .option('--branch <name>', 'branch to check out', 'main')
  .option('--install-docker', 'offer to install Docker when it is missing')
  .option('--dry-run', 'print what would happen, change nothing')
  .action(remoteBootstrap)
for (const name of ['status', 'doctor', 'urls'] as const) {
  describe(remote.command(`${name} <target>`), `Run \`portta ${name}\` there`).action((target, _options, command) => remoteGateway(name, target, command))
}
describe(remote.command('exec <target> [args...]'), 'Run an arbitrary command there')
  .allowUnknownOption(true).action((target, args, _options, command) => remoteExec(target, args, command))
const remoteAccess = describe(remote.command('access'), "Reach a remote project's private TCP services")
describe(remoteAccess.command('open <target>'), 'Open a remote bridge and a tunnel to it')
  .requiredOption('--project <name>', 'Compose project name')
  .requiredOption('--service <name>', 'Compose service name')
  .option('--port <number>', 'the port inside the service')
  .option('--local-port <number>', 'the port to listen on here')
  .option('--dir <path>', 'the gateway directory on the remote host', 'portta')
  .action(remoteAccessOpen)
describe(remoteAccess.command('list', { isDefault: true }).alias('ls'), 'List open tunnels').action((_options, command) => remoteAccessList(command))
describe(remoteAccess.command('close [id]'), 'Close one tunnel, or all of them').option('--all').action(remoteAccessClose)

const tunnel = describe(program.command('tunnel'), 'Publish services over HTTPS with no open port')
describe(tunnel.command('status', { isDefault: true }), "Show the connector's state and the routes it serves").action((_options, command) => tunnelStatus(command))
describe(tunnel.command('setup'), 'Write the connector configuration from a tunnel token')
  .requiredOption('--zone <domain>', 'the domain whose wildcard points at the tunnel')
  .option('--token-file <path>', 'read the tunnel token from a file')
  .option('--origin <url>', 'where the connector reaches the proxy')
  .option('--apex', 'serve the zone apex as well as the wildcard')
  // Registered only so it can be refused with a reason: a token on a command
  // line is visible in `ps` to every user on the host.
  .option('--token <value>', 'refused; use --token-file or the prompt')
  .action(tunnelSetup)
describe(tunnel.command('enable'), 'Start the connector').action((_options, command) => tunnelEnable(command))
describe(tunnel.command('disable'), 'Stop the connector, keeping the configuration')
  .option('--forget', 'delete the configuration and credentials too').action(tunnelDisable)
describe(tunnel.command('test'), 'Check that the tunnel is carrying traffic').action((_options, command) => tunnelTest(command))
describe(tunnel.command('logs'), "Show the connector's own output").option('-n, --lines <count>', 'line count', '50').action(tunnelLogs)

const tls = describe(program.command('tls'), 'Drive local certificates with openssl')
describe(tls.command('status', { isDefault: true }), 'Show certificate and TLS configuration').action((_options, command) => tlsStatus(command))
describe(tls.command('init'), 'Create a local CA and a wildcard certificate for the domain').action((_options, command) => tlsInit(command))
describe(tls.command('trust'), 'Print the command to trust the CA on this machine').action((_options, command) => tlsTrust(command))
describe(tls.command('untrust'), 'Print the command to remove it again').action((_options, command) => tlsUntrust(command))
/**
 * `bin/portta` hands over to this file whenever Node is present, so a command
 * the Bash dispatcher has and Commander does not is unreachable on every host
 * the installer touched — `portta tunnel status` exited 2 with `unknown
 * command` while its implementation sat intact behind `PORTTA_FORCE_BASH`.
 *
 * These passthroughs are the cheap half of the fix and are deliberately
 * temporary: #29 deletes each one in the change that ports it. The parity
 * assertion in `tests/unit/cli.test.sh` is what stops the two surfaces
 * drifting apart again.
 */
const passthroughs = [['toolbox', 'Run pinned operational tools in Docker']] as const
for (const [name, description] of passthroughs) {
  /**
   * `helpOption(false)` matters more than it looks. Each of these commands
   * already prints a page of its own — subcommands, flags, and the reason
   * `tunnel setup` refuses a token on the command line. Commander's built-in
   * `--help` would intercept that and answer with a four-line stub naming
   * `[args...]`, which is how `portta remote --help` has been answering.
   * Forwarding the flag keeps the real page.
   */
  describe(program.command(`${name} [args...]`), description).helpOption(false).allowUnknownOption(true).allowExcessArguments(true).action((args, _options, command) => legacy(name, args, command))
}

/**
 * `portta status | head -3` is an ordinary thing to type, and it made Node
 * throw an unhandled EPIPE and print a stack trace over the output the reader
 * asked for. A closed downstream pipe is not an error here: it means the
 * reader has what they wanted.
 */
function tolerateClosedOutput(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') process.exit(0)
      throw error
    })
  }
}

async function main(): Promise<void> {
  tolerateClosedOutput()
  try {
    if (process.argv.length === 2) {
      program.outputHelp()
      return
    }
    await program.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') return
      process.exitCode = EXIT.usage
      return
    }
    const output = new Output(program.opts())
    if (error instanceof CliError) {
      output.error(error.message)
      if (error.hint) output.hint(error.hint)
      process.exitCode = error.exitCode
      return
    }
    output.error(error instanceof Error ? error.message : String(error))
    process.exitCode = EXIT.failure
  }
}

await main()
