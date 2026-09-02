"""Bare runtime imports reachable from the CLI entry point, vs what it declares."""
import json, pathlib, re, sys

root = pathlib.Path(sys.argv[1])
pkg = json.loads((root / 'packages/cli/package.json').read_text())
declared = set(pkg.get('dependencies', {}))

# esbuild inlines packages/core through an alias, so core's runtime imports
# become the CLI's own. Everything else stays external (`packages: 'external'`).
sources = list((root / 'packages/cli/src').rglob('*.ts')) + list((root / 'packages/core/src').rglob('*.ts'))
pattern = re.compile(r"""^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s*['"]([^'"]+)['"]""", re.M)

missing = set()
for path in sources:
    if path.name.endswith('.test.ts'):
        continue
    for spec in pattern.findall(path.read_text()):
        if spec.startswith(('.', '/', 'node:')) or spec == 'portta-core':
            continue
        name = '/'.join(spec.split('/')[:2]) if spec.startswith('@') else spec.split('/')[0]
        if name not in declared:
            missing.add(name)

print(' '.join(sorted(missing)))
