# Hold On Tight! — Paper Boat on a Molten-Gold Tsunami

[![make.fun](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/Tenguu0/hold-on-tight/rank.svg)](https://make.fun/bounty/ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/Tenguu0/hold-on-tight/reward.svg)](https://make.fun/bounty/ai-excited-01)

An entry for [make.fun's "Make the AI judge excited" bounty](https://make.fun/bounty/ai-excited-01).

A small paper boat surfing a tsunami of molten gold and ink toward the viewer, origami cranes bursting from the wave crest, ink droplets and gold flecks flying out at you — and a speech bubble that says it straight to the judge: **"JUDGE — HOLD ON TIGHT!"**

## How it works

`main.ts` is a fully procedural rasterizer written in pure Node.js standard library — no canvas library, no network, no image assets. It paints the scene pixel by pixel and polygon by polygon (layered gradients, glow, grain, a hand-drawn 5×7 bitmap font for the bubble text) and encodes the PNG itself with `node:zlib` plus a hand-rolled CRC32. One fixed seed drives every random choice, so two runs write byte-identical PNGs.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Writes `out/entry.png` (1024×1024, ≤ 1 MiB). Requires Node 22+.
