# search kitsune stages in order (standing + full-chain starts), baking each: kchain.sh <ticks> <stage>...
export PATH=$HOME/.local/node/bin:$PATH
T=$1; shift
for k in "$@"; do
  python3 -I scratch/ktune.py $k; rm -f scratch/kopt-$k.json
  N=3000 STAGE=$k TICKS=$T npx vitest run scratch/kopt.test.ts > scratch/kopt-$k.log 2>&1
  tail -1 scratch/kopt-$k.prog | cut -c1-200
  if [ -f scratch/kopt-$k.json ]; then python3 -I scratch/kbake.py $k && rm scratch/kopt-$k.json; else sed -i '' "s/^\(  { s: $((k-1)), .*h: \[-1, -1\]\), tune: true }/\1 }/" src/maps/kitsune.ts; fi
done
