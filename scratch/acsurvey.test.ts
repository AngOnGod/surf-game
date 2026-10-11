import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// windowed top-down survey: first thing hit going down from ZT to ZB at each cell.
// '.' ground, '/' surf ramp, 'T' fall teleport above it, '#' solid at ZT, ' ' nothing. Second block: hit heights.
it('survey', () => {
  const b = readFileSync(process.env.BSP ?? 'public/bsp/surf_aircontrol_ksf.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [X0, X1, DX] = process.env.X!.split(',').map(Number), [Y0, Y1, DY] = process.env.Y!.split(',').map(Number), [ZT, ZB] = process.env.Z!.split(',').map(Number);
  const o: [number, number, number] = [0, 0, 0];
  const inShape = (f: (typeof bsp.fails)[number], p: number[]) => p.every((v, k) => v >= f.min[k] && v <= f.max[k]) && (!f.shape || f.shape.some(br => br.every(([nx, ny, nz, d]) => nx * p[0] + ny * p[1] + nz * p[2] <= d)));
  const out: string[] = [`x ${X0}..${X1} step ${DX} (cols), y ${Y1}..${Y0} step ${DY} (rows), z ${ZT}..${ZB}`], zs: string[] = [];
  for (let y = Y1; y >= Y0; y -= DY) {
    let s = '', zl = '';
    for (let x = X0; x <= X1; x += DX) {
      const tr = trace(w, [x, y, ZT], [x, y, ZB], o, o), hz = tr.fraction < 1 ? tr.end[2] : ZB;
      let f = false;
      for (let z = ZT; z >= hz && !f; z -= 16) f = bsp.fails.some(g => g.to && inShape(g, [x, y, z]));
      s += tr.startsolid ? '#' : f ? 'T' : tr.fraction === 1 ? ' ' : tr.normal[2] >= 0.7 ? '.' : '/';
      zl += tr.fraction < 1 && !tr.startsolid ? String(Math.round(hz / 100)).padStart(5) : '    -';
    }
    out.push(`${String(y).padStart(6)} |${s}|`); zs.push(`${String(y).padStart(6)} ${zl}`);
  }
  writeFileSync(process.env.OUT ?? 'scratch/acsurvey.out', out.join('\n') + '\n\nheights (hundreds):\n' + zs.join('\n') + '\n');
});
