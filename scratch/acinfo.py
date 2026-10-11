import struct, sys, re, collections
f=open(sys.argv[1],'rb').read()
print('version',struct.unpack_from('<i',f,4)[0],'rev',struct.unpack_from('<i',f,8+64*16)[0])
for i in range(64):
    ofs,ln,ver,cc=struct.unpack_from('<iii4s',f,8+i*16)
    if ln: print(i,ofs,ln,ver,cc, f[ofs:ofs+4] if ln>=4 else b'')
E=struct.unpack_from('<ii',f,8)
ents=f[E[0]:E[0]+E[1]].decode('latin1')
es=[dict((a.lower(),b) for a,b in re.findall(r'"([^"]*)"\s+"([^"]*)"',m.group(1))) for m in re.finditer(r'\{([^{}]*)\}',ents)]
print(len(es),'entities'); print(collections.Counter(e.get('classname') for e in es).most_common())
