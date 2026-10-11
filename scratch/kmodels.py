import struct, sys
f=open('public/maps/surf_kitsune.bsp','rb').read()
L=lambda i: struct.unpack_from('<iii',f,8+i*16)
ver=struct.unpack_from('<i',f,4)[0]
P,N,LF,LB,M,B,S,TI,TD,SD,ST=L(1),L(5),L(10),L(17),L(14),L(18),L(19),L(6),L(2),L(43),L(44)
leafsize=32 if (ver>19 and LF[2]!=0) else 56
def brushes_of(head):
    out=set(); st=[head]
    while st:
        n=st.pop()
        if n<0:
            o=LF[0]+(-1-n)*leafsize; first,count=struct.unpack_from('<HH',f,o+24)
            for k in range(count): out.add(struct.unpack_from('<H',f,LB[0]+2*(first+k))[0])
        else: st+= list(struct.unpack_from('<ii',f,N[0]+n*32+4))
    return out
def texname(td):
    so=struct.unpack_from('<i',f,ST[0]+4*struct.unpack_from('<i',f,TD[0]+td*32+12)[0])[0]
    o=SD[0]+so; e=f.index(b'\0',o); return f[o:e].decode('latin1')
ents=f[L(0)[0]:L(0)[0]+L(0)[1]].decode('latin1')
import re
for m in re.finditer(r'\{([^{}]*)\}',ents):
    kv=dict((a.lower(),b) for a,b in re.findall(r'"([^"]*)"\s+"([^"]*)"',m.group(1)))
    if kv.get('classname')!='func_brush': continue
    mi=int(kv['model'][1:]); o=M[0]+mi*48
    mins=struct.unpack_from('<3f',f,o); maxs=struct.unpack_from('<3f',f,o+12); head=struct.unpack_from('<i',f,o+36)[0]
    bs=brushes_of(head); texs=set()
    for b in bs:
        first,count,contents=struct.unpack_from('<iii',f,B[0]+b*12)
        for k in range(count):
            pl,ti,disp,bev,thin=struct.unpack_from('<HhhBB',f,S[0]+(first+k)*8)
            if bev: continue
            if ti>=0: texs.add(texname(struct.unpack_from('<i',f,TI[0]+ti*72+68)[0]))
    org=kv.get('origin')
    print(kv.get('targetname'), org, 'bounds', [round(v) for v in mins], [round(v) for v in maxs], 'brushes', len(bs), 'tex', sorted(texs)[:6])
print('--- brush shapes of the red and pink kitsune models')
for m in re.finditer(r'\{([^{}]*)\}',ents):
    kv=dict((a.lower(),b) for a,b in re.findall(r'"([^"]*)"\s+"([^"]*)"',m.group(1)))
    if kv.get('classname')!='func_brush' or kv.get('origin') not in ('-15360 -13432 448','8192 -7792 4216'): continue
    o=M[0]+int(kv['model'][1:])*48; head=struct.unpack_from('<i',f,o+36)[0]
    org=[float(v) for v in kv['origin'].split()]
    for b in sorted(brushes_of(head)):
        first,count,contents=struct.unpack_from('<iii',f,B[0]+b*12)
        sides=[]
        for k in range(count):
            pl,ti,disp,bev,thin=struct.unpack_from('<HhhBB',f,S[0]+(first+k)*8)
            if bev: continue
            nx,ny,nz,d=struct.unpack_from('<4f',f,P[0]+pl*20)
            tex=texname(struct.unpack_from('<i',f,TI[0]+ti*72+68)[0]) if ti>=0 else '-'
            sides.append(f"n({nx:.2f},{ny:.2f},{nz:.2f}) d{d:.0f} {tex.split('/')[-1]}")
        print(' brush', b, 'contents', hex(contents), '|', '; '.join(sides))
