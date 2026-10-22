#!/bin/sh
# Production-rerank passes for UC1/UC2, then UC3 re-ingest + evals. Sequential: Voyage and Groq limits are shared.
cd "$(dirname "$0")/.."
npm run -s uc1:eval -- --ladder --rerank > /tmp/p_uc1.log 2>&1
npm run -s uc2:eval -- --ladder --rerank > /tmp/p_uc2.log 2>&1
npm run -s uc3:ingest > /tmp/i_uc3.log 2>&1
npm run -s uc3:eval -- --ladder > /tmp/l_uc3.log 2>&1
npm run -s uc3:eval -- --naive > /tmp/n_uc3.log 2>&1
UC3_VARIANT=rows npm run -s uc3:eval > /tmp/r_uc3.log 2>&1
echo done > /tmp/final.done
