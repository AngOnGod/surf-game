#!/bin/bash
# surf_progress at TICK (default 128): the planned run phase by phase, each searching on from the last one's finishing
# state (scratch/<tag>.done.json): the hub, parts 1-2, part 3 (into its last section, then that section three times: exits
# A, C, then B), part 4. Logs: scratch/beam-pr<tick><phase>.log; the run: scratch/pr<tick>p4.run.json
export PATH=$HOME/.local/node/bin:$PATH
cd "$(dirname "$0")/.."
T=${TICK:-128}; W=${W:-600}; P=pr$T
FIVE=9200,-13550,-12100,9650,-13050,-11800 # the last section's start (tp_p3s5)
run() { # tag, extra env...
  local tag=$1; shift
  env MAP=progress TICK=$T W=$W H=0 TAG=$P$tag "$@" npx vitest run scratch/beam.test.ts > scratch/beam-$P$tag.out 2>&1
  grep -E "finished|no finish" scratch/beam-$P$tag.log | tail -1
  [ -f scratch/$P$tag.done.json ] || { echo "phase $tag failed"; exit 1; }
}
[ -n "$FROM" ] || { run p0 TAIL=scratch/pr-p0-tail.json DF=scratch/pr-p0-df UNTIL=-15100,-7850,13300,-14800,-7500,13700; FROM=p1; }
case $FROM in p1) run p1 START=scratch/${P}p0.done.json RESEAT=1 TO=0 TAIL=scratch/pr-p1-tail.json DF=scratch/pr-p1-df; FROM=p2;; esac
case $FROM in p2) run p2 START=scratch/${P}p1.done.json RESEAT=1 TO=1 TAIL=scratch/pr-p2-tail.json DF=scratch/pr-p2-df; FROM=p3a;; esac
case $FROM in p3a) run p3a START=scratch/${P}p2.done.json RESEAT=1 UNTIL=$FIVE UNTIL_ANY=1 TAIL=scratch/pr-p3a-tail.json DF=scratch/pr-p3a-df; FROM=p3x;; esac
case $FROM in p3x) run p3x START=scratch/${P}p3a.done.json RESEAT=1 UNTIL=$FIVE TAIL=scratch/pr-p3x-tail.json DF=scratch/pr-p3x-df; FROM=p3c;; esac
case $FROM in p3c) run p3c START=scratch/${P}p3x.done.json RESEAT=1 UNTIL=$FIVE TAIL=scratch/pr-p3c-tail.json DF=scratch/pr-p3c-df; FROM=p3b;; esac
case $FROM in p3b) run p3b START=scratch/${P}p3c.done.json RESEAT=1 TO=2 TAIL=scratch/pr-p3b-tail.json DF=scratch/pr-p3b-df; FROM=p4;; esac
case $FROM in p4) run p4 START=scratch/${P}p3b.done.json RESEAT=1 TAIL=scratch/pr-p4-tail.json DF=scratch/pr-p4-df;; esac
echo "chain done"
