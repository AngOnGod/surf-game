s=open('src/bot.ts').read().replace("from './physics'","from '../src/physics'")
out=[]; n=0
for l in s.split('\n'):
    if 'return ' in l and 'NO_CMD' in l:
        n+=1; l=l.replace('return ', f"return (globalThis as any).why = 'r{n}@' + (globalThis as any).k_, ",1)
    out.append(l)
s='\n'.join(out).replace("const t = route[k + 1], a = route[Math.max(k, 0)];","const t = route[k + 1], a = route[Math.max(k, 0)]; (globalThis as any).k_ = k;")
open('scratch/botdbg.ts','w').write(s)
