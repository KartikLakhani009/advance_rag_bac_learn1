#!/bin/sh
# usage: scripts/run-evals.sh "uc3 uc1 uc2" — naive + ladder per use case (+ UC3 rows variant), sequentially (shared rate limits)
# set SKIP_NAIVE_UC3=1 to skip the first step
cd "$(dirname "$0")/.."
for u in ${1:-uc3 uc1 uc2}; do
  if [ "$u" != "uc3" ] || [ -z "$SKIP_NAIVE_UC3" ]; then npm run -s $u:eval -- --naive > /tmp/n_$u.log 2>&1; fi
  npm run -s $u:eval -- --ladder > /tmp/l_$u.log 2>&1
  if [ "$u" = "uc3" ]; then UC3_VARIANT=rows npm run -s uc3:eval > /tmp/f_uc3.log 2>&1; fi
done
echo done > /tmp/ladders.done
