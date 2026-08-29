# Canvas collaboration

`@anvilkit/canvas-editor/collab` provides the schema-v2 Yjs binding for
granular, local-first `CanvasIR` collaboration. It keeps presence ephemeral,
routes every accepted projection through the normal Canvas document-budget
pipeline, and leaves transport ownership with the host.

Install `yjs` and `y-protocols` alongside the editor when enabling this
optional entry point. Use the same `CanvasRuntime` and document-budget policy
as the editor so every peer admits the same node kinds and limits.

```ts
import {
  createCanvasYjsBinding,
  type CanvasCollabConnectionStatus,
} from "@anvilkit/canvas-editor/collab";
import * as Y from "yjs";

const doc = new Y.Doc();
const binding = createCanvasYjsBinding({
  doc,
  sceneStore,
  stores,
  runtime,
  peer: { id: session.userId, displayName: session.displayName },
  undo: { captureTimeout: 0 },
  connectionSource(emit) {
    const unsubscribe = transport.onStatus(
      (status: CanvasCollabConnectionStatus) => emit(status),
    );
    return unsubscribe;
  },
});
```

The host connects `doc` to its provider and authorization boundary. The
binding does not open sockets, authorize rooms, or persist awareness.

## Authorization model

Canvas exposes one closed authorization vocabulary for both editor commands
and host provider/service checks. The four roles are cumulative only where the
matrix says so; role names alone are never trusted by a command handler.

| Role | Design | Comments | Sharing and roles | Presence | Audit |
| --- | --- | --- | --- | --- | --- |
| `viewer` | Read | Read | None | Read/publish | None |
| `commenter` | Read | Create, reply, resolve, reopen | None | Read/publish | None |
| `editor` | Read/write | Create, reply, resolve, reopen | Read link metadata | Read/publish | None |
| `owner` | Read/write | Create, reply, resolve, reopen | Create, rotate, revoke, expire, and manage roles | Read/publish | Read |

`document.write` is the only design-mutation permission. Keyboard shortcuts,
clipboard operations, public APIs, direct command calls, and stale UI handlers
all require that same action, so a commenter cannot gain write access through
an alternate input path.

Authorization resources are ordered paths: document, optional page, zero or
more nested nodes, and an optional comment thread. A grant inherits from its
scope to descendants. The closest explicit grant wins, which means a page or
node grant can deliberately downgrade an inherited document role. `owner` is
valid only at document scope.

Denial is fail-closed:

- an explicit subject or wildcard deny at any matching ancestor overrides all
  grants;
- conflicting grants at the same scope are denied rather than guessed;
- malformed resource ancestry, invalid owner scope, and missing grants deny;
- page, node, or thread assignments never grant access to unrelated branches.

Use `resolveCanvasAuthorization` for presentation decisions and
`assertCanvasAuthorized` again at every command and provider/service boundary.
The latter throws a stable `CanvasAuthorizationError` without document or
comment content. Comments, sharing records, and presence are collaboration
metadata, not Puck render state; they do not create a parallel document model
or alter the Config/Data rendering pipeline.

For editor command enforcement, bind the current host session through the
optional collaboration entry and pass the resulting decision to the root
editor. Recompute it when refreshed grants change; the next render makes every
command, shortcut, clipboard action, and undo observe the new decision.
The narrow editor input contains only whether `document.write` is allowed;
use the full decision APIs above for provider errors and audit detail.

```tsx
import { CanvasStudio } from "@anvilkit/canvas-editor";
import { isCanvasDocumentWriteAllowed } from "@anvilkit/canvas-editor/collaboration";

<CanvasStudio
  initialIR={document}
  canWrite={isCanvasDocumentWriteAllowed(session, document.id)}
/>
```

## Share-link lifecycle

Import host sharing and comment APIs from
`@anvilkit/canvas-editor/collaboration`. `CanvasShareLinkProvider` is the host
service boundary for create, list/copy,
expire, revoke, rotate, and token authorization. `createMemoryCanvasShareLinkProvider`
is the deterministic local/test provider; production hosts implement the same
protocol using durable service storage. Every method accepts an `AbortSignal`.

Links grant only `viewer`, `commenter`, or `editor`; ownership is never
transferable through a token. Rotation keeps the link ID and increments its
token version while immediately invalidating the previous token. Expiration
and revocation are checked on every authorization and copy request, so cached
or stale UI state cannot keep a link active. Revoke and expire are idempotent.

Identity restrictions are host-supplied verified claims. A link may require an
authenticated identity and may contain allowed identity IDs and domains. When
both lists exist they are conjunctive. `CanvasShareLinkHostPolicy` can further
deny creation or access for tenant, domain, identity, or product policy without
putting host rules in the editor. Denials use stable codes and do not expose a
raw provider response.

Use `copyCanvasShareLink` with a host-owned clipboard writer. It obtains the
current active URL immediately before copying instead of retaining a token in
UI state.

Wrap UI-facing providers with `createAuthorizedCanvasShareLinkProvider`. It
calls `getSession()` for every operation, so a role change or refreshed token
takes effect on the next request, and it verifies link IDs belong to the
authorized document before mutation. Production services MUST repeat the same
authorization using trusted server identity; the client facade is defense in
depth, not the service trust boundary.

## Anchored comment threads

Canvas Core owns only the versioned anchor contract: document, page, node,
coordinate, and selection anchors. Thread bodies, authors, replies, and other
collaboration metadata stay outside `CanvasIR`, so comments cannot alter
rendering, export, undo, or persisted design data.

`CanvasCommentThreadProvider` is the host storage boundary. The deterministic
memory provider is intended for local/test use; production hosts persist the
same records in a collaboration service. Every returned thread resolves its
anchor against the current document. Node and selection anchors follow stable
node IDs across moves and page changes. A missing target returns an archived
anchor resolution while retaining the thread; restoring the same stable ID
makes the anchor active again. Clones receive fresh IDs and never inherit the
source thread.

Wrap UI-facing storage with `createAuthorizedCanvasCommentThreadProvider`.
Commenters, editors, and owners can create; viewers can only read. The wrapper
rechecks the latest session for every operation and rejects cross-document
access. Production services repeat this check using trusted server identity.

Threads support replies, explicit user-ID mentions, resolve/reopen transitions,
and per-user unread counts. A resolved thread retains every message but rejects
new replies until reopened. `markRead` affects only the requesting user's
collaboration metadata and never writes Canvas IR.

Hosts provide `CanvasCommentNotificationProvider` when delivery is enabled.
Notification envelopes contain document/thread IDs, actors, recipients,
timestamps, kinds, and deterministic idempotency keys—never message bodies or
anchor content. The comment provider reads host preferences before delivery,
with separate reply, mention, and resolution controls. Providers MUST dedupe by
the supplied key; the memory implementation demonstrates that contract.

`CommentThreadPanel` supplies a keyboard and screen-reader-operable host view.
Opening it focuses its heading; replies use a labeled form and semantic list;
resolve/reopen status is announced; anchor navigation is explicit; and closing
returns focus to the host-provided anchor element.

## Persisted model and migration

Schema version 2 stores document fields, page order, pages, nodes, child
order, assets, components, external component snapshots, and rich text in
independently addressable Yjs types. Node fields are separate registers,
orders are stable-ID `Y.Array` values, and rich text is `Y.Text` with span and
paragraph attributes. A parent register selects one parent after concurrent
reparenting; live children of a tombstoned group are deterministically hoisted
to its first live ancestor.

On first open, a valid legacy whole-document `canvasIR` room is converted once
through the bounded Canvas load pipeline. Its exact JSON is retained as a
recovery snapshot. Corrupt legacy data is retained but never applied. A newer
schema or a later legacy write makes this client fail closed until the host
upgrades the incompatible peer or explicitly repairs the room.

## Undo and offline state

When `undo` is enabled, `undo()`, `redo()`, `canUndo()`, `canRedo()`,
`clearUndo()`, and `onUndoStackChange()` operate on a `Y.UndoManager` scoped
to the schema-v2 root and the exact local peer origin. Remote transport and
other-peer transactions never enter this stack.

Yjs document state is the offline work queue. Feed provider lifecycle events
through `connectionSource`; `getSyncState()` and `onSyncStateChange()` expose
`connecting`, `offline`, `reconnecting`, `synced`, and `error` states plus the
number of local transactions retained since the last `synced` acknowledgement.
The counter resets only when the provider reports that synchronization is
complete.

## Diagnostics and recovery

Invalid remote state stays in the `Y.Doc` for investigation but does not
replace the open editor document. Local collaboration writes pause until an
explicit repair. Read `getRecoveryState()`, inspect `getDiagnostics()`, or
subscribe with `onDiagnostic()`.

| Code | Meaning | Recommended action |
| --- | --- | --- |
| `invalid-projection` | Shared state cannot produce bounded, valid `CanvasIR`. | Export, inspect, then repair from the last valid document. |
| `incompatible-schema` | The room requires another collaboration schema. | Upgrade the client before writing; export first if repair is unavoidable. |
| `mixed-schema` | A legacy whole-document writer touched a schema-v2 room. | Upgrade/remove the stale writer, export, then repair. |
| `corrupt-legacy` | Legacy JSON could not be decoded or validated. | Export the preserved legacy snapshot. |
| `repair-succeeded` | Explicit schema-v2 reconstruction completed. | Resume synchronization. |
| `repair-failed` | Reconstruction could not complete. | Keep the room read-only and export recovery data. |

`exportRecoveryPackage()` returns the current Yjs v2 state update, schema
version, diagnostics, preserved legacy JSON when available, and a clone of the
last valid editor document. Persist the binary `yjsStateUpdate` with the rest
of the package or encode it for a text-only container.

`repairFromLastValid()` is intentionally explicit. It rebuilds the schema-v2
root from the last valid editor document in one local-origin transaction,
preserves the legacy recovery snapshot, resets collaborative undo, and records
the outcome. Export before repair when the invalid state may be needed for
forensics.

Call `destroy()` when leaving the room. It removes document, transport,
presence, undo, sync-state, and diagnostic listeners; it does not destroy the
host-owned `Y.Doc` or provider.

## Presence and collaborator affordances

Presence is ephemeral awareness state: verified peer identity, page-space
cursor coordinates, and stable node-ID selections. `RemoteCursors` and
`RemoteSelections` render that state in the non-exported presence layer with
screen-stable chrome. They never write design content or comment storage.

The canvas accepts that optional chrome through `presenceLayer`, keeping the
collaboration runtime out of local-only editors. Wrap the editor with the
binding's `CanvasPresenceContext`, then pass the two `/collab` overlays:

```tsx
<CanvasPresenceContext value={binding.presence}>
  <CanvasStudio
    initialIR={document}
    presenceLayer={
      <>
        <RemoteCursors />
        <RemoteSelections />
      </>
    }
  />
</CanvasPresenceContext>
```

Use `CollaboratorPresenceList` from the `/collab` entry beside the canvas to
provide the accessible counterpart. It announces connection and pending-sync
state and describes every visible collaborator's cursor and selection in text,
so identity and activity are not conveyed by color or canvas pixels alone.
Disconnecting awareness removes only ephemeral presence; persisted comments
and `CanvasIR` remain unchanged.

## Activity and audit events

`CanvasActivitySink` receives a closed, idempotent event vocabulary for share
link lifecycle, role changes, comment lifecycle, and collaboration recovery.
Every record contains only stable IDs, roles/scope, lifecycle kind, timestamp,
and bounded outcome metadata. Link URLs/tokens and restrictions, comment bodies
and anchors, document content, recovery snapshots, provider errors, and raw
presence payloads are excluded by construction. The deterministic memory sink
also rejects runtime-injected fields and deduplicates by `idempotencyKey`.

Authorized share providers and comment/recovery producers emit automatically
when given a sink. Hosts call `recordCanvasRoleChange` at their durable role
service boundary because Canvas does not own role persistence. Sink failures
are isolated from the user operation; production sinks should synchronously
enqueue durable delivery and enforce the same idempotency key.
