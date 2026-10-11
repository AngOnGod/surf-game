import struct, sys, re, collections
f=open(sys.argv[1],'rb').read()
E=struct.unpack_from('<ii',f,8)
ents=f[E[0]:E[0]+E[1]].decode('latin1')
M=struct.unpack_from('<ii',f,8+14*16)
def box(e):
    if not e.get('model','').startswith('*'): return ''
    o=M[0]+int(e['model'][1:])*48; mn=struct.unpack_from('<3f',f,o); mx=struct.unpack_from('<3f',f,o+12)
    org=[float(x) for x in e.get('origin','0 0 0').split()]
    return 'box %s..%s'%(tuple(round(a+b) for a,b in zip(mn,org)),tuple(round(a+b) for a,b in zip(mx,org)))
skip={'light','info_player_terrorist','info_player_counterterrorist'}
for m in re.finditer(r'\{([^{}]*)\}',ents):
    raw=m.group(1); kv=dict((a.lower(),b) for a,b in re.findall(r'"([^"]*)"\s+"([^"]*)"',raw))
    if kv.get('classname') in skip: continue
    outs=[b for a,b in re.findall(r'"([^"]*)"\s+"([^"]*)"',raw) if a.lower().startswith('on')]
    keep={k:v for k,v in kv.items() if k in('classname','targetname','target','filtername','origin','angles','speed','pushdir','spawnflags','damage','startdisabled','filtertype','filtername','negated','damagetype','model')}
    print(keep, box(kv), outs if outs else '')
