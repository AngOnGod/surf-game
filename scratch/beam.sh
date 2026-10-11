# start a beam search, stopping any that is still running first (they share logs); args are env assignments,
# e.g. MAP=utopia_v3 TICK=128 W=200
ps aux | grep -E "[n]ode_modules/(\.bin/)?vitest" | awk '{print $2}' | xargs -r kill 2>/dev/null; sleep 1
export PATH=$HOME/.local/node/bin:$PATH
env "$@" npx vitest run scratch/beam.test.ts > scratch/beam.out 2>&1
