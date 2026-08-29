# Canvas interaction preview benchmark

PLAN-0039 E4-T6 fixes six deterministic preview workloads: flat documents at
100, 1,000, and 5,000 resolved nodes, plus 1,000-node text-, image-, and
component-heavy documents. Run them with:

```sh
pnpm --filter @anvilkit/canvas-editor bench:interaction
```

The harness reports median and nearest-rank p95 input-to-preview latency over
200 observed frames after 20 warmups. It measures the synchronous work behind
one coalesced visual frame: preview-store publish, dirty-scope derivation,
component expansion, Auto Layout, and resolved-store publish. React/Konva
paint timing remains observable through `onPerformanceEvent`; this deterministic
CPU gate does not pretend that Node renders browser pixels.

Raw p95 is always checked against the E4 budgets: 16.7 ms at 1,000 nodes and
50 ms at 5,000 nodes. The 100-node fixture uses the 16.7 ms frame budget as a
small-document tripwire. The shape-heavy 1,000-node fixtures use the same
16.7 ms direct-manipulation budget.

## Regression normalization

GitHub-hosted runner CPU models vary. Each preview sweep is therefore followed
by a fixed typed-array traversal, and the committed baseline stores raw preview
p95 divided by calibration median. Calibration runs separately so it cannot
evict the document working set immediately before a measured frame. CI fails
when normalized p95 is more than 15% above the baseline while still reporting
raw median and p95 in milliseconds. This makes runner speed an explicit input
instead of silently calling every hosted runner the reference desktop.

The 100-node fixture remains an absolute-budget tripwire but is excluded from
the relative gate: its sub-millisecond tail is timer/scheduler-noise dominated.
The 1,000-node, 5,000-node, and all shape-heavy fixtures are regression-gated.

The baseline is captured only on the Canvas reference desktop already
nominated by Canvas Core: Intel i5-10300H, 8 logical cores, Linux x64 on WSL2,
Node 24. Regenerate it only after an intentional performance change:

```sh
ANVILKIT_CANVAS_INTERACTION_UPDATE_BASELINE=1 \
  pnpm --filter @anvilkit/canvas-editor bench:interaction
```

Review the raw and normalized movement before accepting the updated JSON. A
capture records the worst median/p95 from three complete passes so routine
garbage collection and scheduler variance are part of the reference envelope,
not a false regression on the next run. A synthetic canary in the unit suite
proves that exactly 15% passes and anything above 15% fails.
