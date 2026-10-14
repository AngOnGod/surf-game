#!/bin/bash
# surf_progress, per part: a free-space guide (flood fill from the part's spawn to its goal, shortened to clear segments)
# and a distance field to the goal, for the planner's DF mode. Usage: scratch/progress-prep.sh p1|p2|p3a|p3b|p3c|p4
export PATH=$HOME/.local/node/bin:$PATH
cd "$(dirname "$0")/.."
BSP=public/maps/surf_progress_fix.bsp.gz
case $1 in
  p0)  BOX=8900,9400,-200,15000,14200,800; START=11968,10016,-8; GOAL=9600,11424,-88,9728,11552,688 ;;
  p3b) BOX=2000,-14000,-16100,14000,-2400,-11000; START=9408,-13312,-12072; GOAL=9184,-3552,-15482,9696,-3076,-15171 ;;
  p3c) BOX=2000,-14000,-16100,14000,-2400,-11000; START=9408,-13312,-12072; GOAL=12188,-5279,-15482,12887,-4581,-15171 ;;
  p1)  BOX=-15900,-16300,7100,-1000,-6700,14300; START=-14944,-7680,13432; GOAL=-2112,-10752,10312,-1984,-10624,11088 ;;
  p2)  BOX=-12600,-2800,-10900,11200,15700,-5100; START=-11616,14752,-5960; GOAL=10016,-1088,-9016,10144,-960,-8240 ;;
  p3a) BOX=-8900,-16200,-12700,13900,-600,-1100; START=-320,-11104,-2312; GOAL=9150,-13550,-12090,9650,-13050,-11850 ;;
  p3x) BOX=2000,-14000,-16100,14000,-2400,-11000; START=9408,-13312,-12072; GOAL=5992,-5283,-15482,6690,-4585,-15171 ;;
  p4)  BOX=-5100,-10300,-300,16200,16400,9300; START=14912,5216,8136; GOAL=-3294,-8638,2976,30,-5314,3488 ;;
  *) echo "unknown part $1"; exit 1 ;;
esac
OUT=scratch/pr-$1
env BSP=$BSP BOX=$BOX CELL=64 START=$START GOAL=$(echo $GOAL | awk -F, '{printf "%d,%d,%d", ($1+$4)/2, ($2+$5)/2, ($3+$6)/2}') SWEEP=1 OUT=$OUT-flood.json npx vitest run scratch/flood.test.ts > $OUT-flood.out 2>&1
head -1 $OUT-flood.json.txt
env BSP=$BSP PATHFILE=$OUT-flood.json OUT=$OUT-tail.json npx vitest run scratch/simplify.test.ts > $OUT-simp.out 2>&1
python3 -c "import json; print(len(json.load(open('$OUT-tail.json'))), 'tail points')"
env BSP=$BSP BOX=$BOX CELL=64 GOAL=$GOAL OUT=$OUT-df npx vitest run scratch/df.test.ts > $OUT-df.out 2>&1
cat $OUT-df.txt
