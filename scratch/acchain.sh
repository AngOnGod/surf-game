#!/bin/zsh
# robust per-section searches at 128 tick (6 variants each), baking each section's result before the next
cd "$(dirname "$0")/.."
export PATH=$HOME/.local/node/bin:$PATH
for k in ${=SECTIONS:-1 2 3 4 5}; do
  rm -f scratch/acopt-$k.json scratch/acopt-$k.prog.dbg
  SEC=$k N=${N:-3000} TICKS=128 npx vitest run scratch/acopt.test.ts > scratch/acopt-$k.log 2>&1
  echo "== section $k: $(head -1 scratch/acopt-$k.prog | cut -c1-120)"; tail -1 scratch/acopt-$k.prog | cut -c1-160
  [ -f scratch/acopt-$k.json ] && python3 scratch/acbake.py $k && rm scratch/acopt-$k.json
done
echo CHAIN DONE
