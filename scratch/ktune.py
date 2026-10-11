# mark stage <k>'s in-air stations (1-based) in src/maps/kitsune.ts as tunable, for scratch/kopt.test.ts
import re, sys
p = 'src/maps/kitsune.ts'; s = open(p).read()
for k in map(int, sys.argv[1:]):
    s = re.sub(r'(\{ s: %d, g: .*?h: \[-1, -1\])( \})' % (k - 1), r'\1, tune: true\2', s)
open(p, 'w').write(s)
