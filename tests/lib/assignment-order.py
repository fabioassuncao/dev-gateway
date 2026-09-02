"""Top-level variables used before they are assigned.

`set -euo pipefail` turns one of these into "unbound variable" at the moment the
line runs, which is a long way from where the mistake is and a long way into a
run that has already changed the machine. Neither `bash -n` nor shellcheck
reports it: the code is syntactically fine and the variable is assigned, just
too late.

Only top-level lines are compared. A use inside a function body runs whenever
the function is called, which says nothing about the order of the definitions.
`${VAR:-default}` and friends are safe under `set -u` and are skipped.
"""
import re, sys, pathlib
src = pathlib.Path(sys.argv[1]).read_text().split('\n')

# Only top-level lines: a use inside a function body runs whenever the function
# is called, which says nothing about the order of the definitions.
depth, toplevel = 0, []
for n, line in enumerate(src, 1):
    stripped = line.strip()
    if re.match(r'^[a-z_]+\(\)\s*\{', stripped):
        # A one-line definition opens and closes on the same line, so count
        # its braces rather than assuming everything after it is a body.
        depth += stripped.count('{') - stripped.count('}')
        continue
    if depth:
        depth += stripped.count('{') - stripped.count('}')
        if depth < 0: depth = 0
        continue
    toplevel.append((n, line))

assigned, used = {}, {}
for n, line in toplevel:
    code = re.sub(r'#.*$', '', line)
    for m in re.finditer(r'(?:^|\s|;)([A-Z][A-Z0-9_]*)=', code):
        assigned.setdefault(m.group(1), n)
    # `${VAR:-x}` and friends are safe under set -u, so only bare uses count.
    for m in re.finditer(r'\$\{?([A-Z][A-Z0-9_]*)\}?', code):
        var = m.group(1)
        after = code[m.end(1):m.end(1) + 2]
        if after.startswith(':') or after.startswith('-') or after.startswith('+'):
            continue
        used.setdefault(var, n)

bad = [(v, assigned[v], used[v]) for v in used
       if v in assigned and used[v] < assigned[v]]
for v, a, u in sorted(bad, key=lambda t: t[2]):
    print(f'{v}: used at line {u}, assigned at line {a}')
sys.exit(1 if bad else 0)
