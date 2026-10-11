// same inputs in node and the browser; per function: a hash of result bits + the first few (input, result) pairs
(function () {
  let seed = 12345; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const buf = new Float64Array(1), u32 = new Uint32Array(buf.buffer);
  const bits = x => { buf[0] = x; return u32[0] ^ (u32[1] * 31); };
  const fns = {
    sin: () => { const x = (r() - 0.5) * 20; return [x, Math.sin(x)]; },
    cos: () => { const x = (r() - 0.5) * 20; return [x, Math.cos(x)]; },
    asin: () => { const x = r() * 2 - 1; return [x, Math.asin(x)]; },
    atan2: () => { const y = (r() - 0.5) * 4000, x = (r() - 0.5) * 4000; return [[y, x], Math.atan2(y, x)]; },
    hypot2: () => { const a = (r() - 0.5) * 4000, b = (r() - 0.5) * 4000; return [[a, b], Math.hypot(a, b)]; },
    hypot3: () => { const a = (r() - 0.5) * 4000, b = (r() - 0.5) * 4000, c = (r() - 0.5) * 4000; return [[a, b, c], Math.hypot(a, b, c)]; },
  };
  const out = {};
  for (const [k, f] of Object.entries(fns)) { let h = 0; const ex = []; for (let i = 0; i < 200000; i++) { const [x, y] = f(); h = (h * 1000003 + bits(y)) >>> 0; if (i < 3000) ex.push(y); } out[k] = { h, ex }; }
  return out;
})()
