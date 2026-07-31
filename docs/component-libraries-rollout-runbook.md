# Component libraries & brand governance: rollout and rollback runbook

Operational runbook for plan 0021 (T-053). Written 2026-07-30 at M5.

## 1. The flags

Three switches, all on `CanvasStudioProps`, all default-off.

| Switch | Type | Default | Gates |
| --- | --- | --- | --- |
| `externalComponents` | `boolean` | `false` | Libraries source, search, insert, recovery |
| `componentVariants` | `boolean` | `false` | Variant authoring affordances |
| `brandGovernance` | `CanvasBrandPolicyContext \| undefined` | absent | Policy enforcement and blocking |

### 1.1 Why governance is a context rather than a boolean

The plan asked for three boolean flags. Governance ships as the presence or
absence of its context object instead, and that is a deliberate deviation.

A boolean plus a context is two sources of truth with an unrepresentable-but-
reachable state: `brandGovernance: true` with no capability snapshot. Every
call site would then need a "flag on but nothing to enforce" branch, and the
safe behaviour for that branch is ambiguous — enforce nothing (the flag lied)
or block everything (the host's rollout breaks). Absence *is* the off switch,
`resolveEffectivePolicyContext` resolves it to `CANVAS_PERMISSIVE_POLICY_CONTEXT`
in one place, and there is no way to enable enforcement without saying what to
enforce.

### 1.2 What no flag ever gates

**Read, render, resolve, recover, report, export.** A flag gates *authoring*
only. This is the single most important property in this document:

- A document containing external components must open, render and export with
  `externalComponents: false`.
- A document containing `variantSelection` must resolve to the same variant with
  `componentVariants: false`. Gating resolution would re-render every instance
  at its default variant — a visual regression across every page at once.
- A document containing policies must keep them with governance absent.

Turning a flag off is a rollback. Turning it off and losing content is data
loss with a clean exit code, which is worse than an outage because it is
silent and survives the next save.

`src/__tests__/rollback-rehearsal.test.ts` is the executable form of this
section.

## 2. Ship order

Ship read before write, and warning before blocking.

1. **Snapshot render + export.** All flags off. Documents authored elsewhere
   open, render and export correctly. Nothing new is reachable in the UI.
2. **`externalComponents: true`.** Search, insert, recovery. Still no
   governance.
3. **`componentVariants: true`.** Variant authoring.
4. **`brandGovernance` with `enforcement: "warning"`.** Compliance is reported
   and navigable; nothing is refused. Watch
   `anvilkit.canvas.brand.compliance_run` warning counts.
5. **`brandGovernance` with `enforcement: "blocking"`.** Only after host
   certification (D-5). OD-10 means a component's `recommendedEnforcement`
   takes effect *only* at this step, so this is the first point at which any
   edit can be refused.

Step 5 is the only irreversible-feeling one for users, because it is the first
that says no. It is still reversible: drop back to `"warning"`.

## 3. Rollback

### 3.1 Procedure

1. Set the offending flag to `false` (or drop `brandGovernance` to `"warning"`,
   then to absent).
2. Reload. No migration, no data change, no re-save required.
3. Verify against §3.2.

Rollback needs no document rewrite. That is by construction: every shape this
plan introduced is additive and optional in the IR, and the schemas are loose
(CON-5), so an older reader preserves what it does not understand.

### 3.2 Verification checklist

After a rollback, confirm on a document that used the feature:

- [ ] External component instances still render (not placeholders).
- [ ] `externalComponentSnapshots` still contains every key it did before,
      including snapshots nothing currently references. GC is an explicit
      action and never a side effect of loading.
- [ ] `variantSelection` is unchanged on every instance, and instances render
      the selected variant rather than the default.
- [ ] `overrides` are unchanged.
- [ ] Component `policy` blocks are still present.
- [ ] `compatibility.requiredCapabilities` is unchanged.
- [ ] Unknown/vendor fields written by a newer build survive.
- [ ] No instance resolved to a *different version* than before. Resolution is
      by exact ref (`libraryId/componentId/version/integrity`); there is no
      `latest` lookup anywhere in the pipeline, and recovery never substitutes
      another version.
- [ ] Export still produces the same artifacts.

Every line above is asserted by `rollback-rehearsal.test.ts`.

## 4. Flag interactions (F-8)

| Combination | Result |
| --- | --- |
| `externalComponents: false` + document has external components | Renders and exports from stored snapshots; Libraries source hidden; no insert/recovery UI |
| `componentVariants: false` + document has variant selections | Resolves to the selected variant; no variant editing UI |
| governance absent + document has policies | Policies persist and are ignored; every affordance available |
| governance `"warning"` + `recommendedEnforcement: "blocking"` | Reported as a warning. A library cannot escalate a host running advisory (OD-10) |
| governance `"blocking"` + no component policy | Ordinary nodes stay warnings forever. Enabling governance cannot retroactively block an existing document |
| `externalComponents: false` + governance `"blocking"` | Governance still enforces on existing external instances — enforcement is not gated on authoring |
| governance `"blocking"` + a quarantined snapshot | Export refuses with `component-unresolved` until the exact version is re-fetched or the instance removed |

### 4.1 Pinning a component (`allowSourceUpdate` / `allowSourceSwap`)

Two separate policy fields, both defaulting to permitted, both intersecting down
the instance path like `allowDetach`:

| Field | `false` means |
| --- | --- |
| `allowSourceUpdate` | Instances may not be moved to a different VERSION of this component |
| `allowSourceSwap` | Instances may not be replaced by a DIFFERENT component |

They are separate because the two are different risks and a brand owner may want
opposite answers. "Take my bug fixes, but do not let anyone substitute a
different component for our logo lockup" is `allowSourceUpdate: true` with
`allowSourceSwap: false` — a posture one combined field could not express.

Both are still subject to the host capability: `canUpdateComponents: false`
denies both regardless of policy, and reports `capability-denied` rather than the
policy reason, because the remedies differ (ask an administrator vs. change the
component). And both honour OD-10: under `enforcement: "warning"` a denial is
reported, not enforced.

## 5. Integrity failures in production

A snapshot whose stored bytes no longer hash to its `integrity` is
**quarantined, not deleted** (T-045):

- The document still mounts. One instance degrades to a placeholder.
- The exact ref stays in the document, so the Libraries panel can re-fetch
  precisely that version.
- Export is blocked until it is recovered or the instance removed.

Re-verification defaults: **off** for host-persisted documents, **on** for
imported files. A host may opt a persisted document *in*
(`mode: "all"`). It cannot opt an import *out* — that combination has no API.

If a wave of integrity failures appears after a library publish, the likely
cause is a republish under an existing version (same-version content
substitution). The remedy is publishing a new version, not relaxing
verification.

## 6. Observability

Nine product events under `anvilkit.canvas.*` via `onAnalyticsEvent`, and a
separate audit stream via `onGovernanceAuditEvent`.

Watch during rollout:

- `anvilkit.canvas.brand.compliance_run` — warning/blocking counts per run.
  A jump at step 5 is expected; a jump at step 4 is not.
- `anvilkit.canvas.brand.operation_blocked` — should be zero before step 5.
- `anvilkit.canvas.library.searched` with `outcome: "error"` — Provider health.
- `anvilkit.canvas.component.update_checked` with `outcome: "offline"` —
  expected offline, suspicious online.

Neither stream carries credentials, document content, text values, asset URLs,
or user identity; library and component ids are hashed. The audit envelope
carries no actor — the host adds authenticated identity in its own system.

## 7. Known limitations at M5

- **Variant authoring UI is not mounted.** `VariantControls` is exported and
  tested but no panel renders it yet, so `componentVariants` currently gates a
  surface that is not yet reachable. The flag is in place ahead of the UI
  deliberately: adding the switch later would mean shipping the UI unflagged.
- *(Resolved 2026-07-30.)* The source operations previously had no per-instance
  policy rule. `allowSourceUpdate` and `allowSourceSwap` now exist — see §4.1.
- **Perf budgets are asserted with an 8× environment allowance**, not as true
  p95 on a pinned runner. Measured values are far inside the targets; the
  pinned gate is a follow-up.
