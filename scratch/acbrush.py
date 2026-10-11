# brushes containing a point: index, contents, side textures (raw BSP)
import struct, sys
f=open(sys.argv[1],'rb').read()
L=lambda i: struct.unpack_from('<ii',f,8+i*16)
P,B,S,TI,TD,SD,ST=L(1),L(18),L(19),L(6),L(2),L(43),L(44)
def texname(ti):
    if ti<0: return '-'
    td=struct.unpack_from('<i',f,TI[0]+ti*72+68)[0]
    so=struct.unpack_from('<i',f,ST[0]+4*struct.unpack_from('<i',f,TD[0]+td*32+12)[0])[0]
    o=SD[0]+so; e=f.index(b'\0',o); return f[o:e].decode('latin1')
for pt in sys.argv[2:]:
    x,y,z=map(float,pt.split(','))
    for b in range(B[1]//12):
        first,count,contents=struct.unpack_from('<iii',f,B[0]+b*12)
        inside=True; texs=set()
        for k in range(count):
            pl,ti,disp,bev,thin=struct.unpack_from('<HhhBB',f,S[0]+(first+k)*8)
            nx,ny,nz,d=struct.unpack_from('<4f',f,P[0]+pl*20)
            if nx*x+ny*y+nz*z>d+0.01: inside=False; break
            texs.add(texname(ti))
        if inside: print(pt,'brush',b,'contents',hex(contents),sorted(texs))
