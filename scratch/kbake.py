# bake kopt-<stage>.json values (h0, h1, cut) into src/maps/kitsune.ts for the given stages, at full precision
import json, re, sys
p = 'src/maps/kitsune.ts'; s = open(p).read()
start = s.index('export const STATIONS'); body_start = s.index('= [', start) + 3; end = s.index('\n];', body_start)
lines = s[body_start:end].split('\n')
for k in map(int, sys.argv[1:]):
    vals = json.load(open(f'scratch/kopt-{k}.json'))
    j = 0
    for i, l in enumerate(lines):
        m = re.match(r'\s*\{ s: (\d+), ', l)
        if not m or int(m.group(1)) != k - 1 or ('h: [-1, -1]' in l and 'tune: true' not in l): continue
        v = vals[j]; j += 1
        if 'tune: true' in l: # in-air points: apply the tuned offsets
            pts = [[float(c) for c in q.split(',')] for q in re.findall(r'\[(-?[\d.]+, -?[\d.]+, -?[\d.]+)\]', l.split('h:')[0])]
            new = ', '.join('[' + ', '.join(str(round(c + v[i * 3 + a])) for a, c in enumerate(pt)) + ']' for i, pt in enumerate(pts))
            l = re.sub(r'g: \[.*\], h:', f'g: [{new}], h:', l).replace(', tune: true', '')
            lines[i] = l; continue
        l = re.sub(r"h: \[[^\]]*\](, cut: [0-9.e+-]+)?", f"h: [{v[0]!r}, {v[1]!r}]" + (f", cut: {v[2]!r}" if len(v) > 2 else ''), l)
        lines[i] = l
    assert j == len(vals), (k, j, len(vals))
s = s[:body_start] + '\n'.join(lines) + s[end:]
open(p, 'w').write(s)
