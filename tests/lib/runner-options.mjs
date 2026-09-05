export function parseOptions(args) {
  let mode, suite, spec, profile, template
  const aliases = { '--all': 'release', '--fast': 'integration', '--unit': 'unit', '--integration': 'integration', '--release': 'release', '--e2e': 'e2e', '--lint': 'lint', '--compose': 'compose' }
  const notices = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') return { mode: 'help', notices }
    if (aliases[arg]) {
      if (mode) throw new Error('Choose one validation mode')
      mode = aliases[arg]
      if (arg === '--fast' || arg === '--unit') notices.push(`${arg} is a legacy alias with broad scope; use targeted tests during development.`)
    } else if (['--suite', '--spec', '--profile', '--template'].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith('-')) throw new Error(`Missing value for ${arg}`)
      if (arg === '--suite') { if (suite) throw new Error('Duplicate --suite'); suite = value }
      if (arg === '--spec') { if (spec) throw new Error('Duplicate --spec'); spec = value }
      if (arg === '--profile') profile = value
      if (arg === '--template') template = value
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!mode) { mode = 'integration'; notices.push('Default: broad integration validation. Ordinary development should use a targeted test.') }
  if ((suite || spec) && mode !== 'e2e') throw new Error('--suite/--spec require --e2e')
  if (suite && spec) throw new Error('Choose --suite or --spec')
  if (profile && template) throw new Error('Choose --profile or --template')
  if ((profile || template) && mode !== 'compose') throw new Error('--profile/--template require --compose')
  return { mode, suite, spec, profile, template, notices }
}
