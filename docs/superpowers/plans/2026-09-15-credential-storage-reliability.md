# Credential Storage Reliability Implementation Plan

**Goal:** Make the credential store unable to prevent Apple Pi from starting, without ever weakening how credentials are protected. Keep the fail-closed rule for persistence and remove the failure paths that turned a credential problem into a broken install.

**Architecture:** `CredentialBroker` keeps its `ProtectedStorage` seam and gains a `CredentialStorageIssue` value describing any degradation. `storagePolicy` becomes total: it always answers `persistent` or `session` and never throws. Mutations are serialized so a read-modify-write cannot lose an entry.

**Tech Stack:** Electron 39 `safeStorage`, vitest 4, `node:fs/promises`.

**Spec:** The [credential storage and keychain policy](../../architecture/credential-storage-keychain-policy.md) defines what may and may not change.

## Global Constraints

- Never persist a credential without OS protection, and never bypass the keychain. See the policy above.
- Degrade to session-only storage rather than failing to start.
- Keep the plaintext key out of the renderer and out of log sinks.
- Do not weaken or remove existing assertions in `credential-broker.test.ts`; extend them.

---

### Task 1: Make `storagePolicy` total

- [x] Return `session` instead of throwing when darwin/win32 cannot reach protected storage.
- [x] Keep Linux `basic_text` and unknown backends on the `session` path.
- [x] Cover every platform/availability combination with table-driven tests.

### Task 2: Survive an unreadable store

- [x] Quarantine a store that cannot be parsed as `credentials.json.corrupt-<timestamp>`.
- [x] Continue with an empty in-memory document so the window still opens.
- [x] Report the condition through `storageIssue()` and a warning log.

### Task 3: Prevent lost writes

- [x] Serialize `setApiKey` and `delete` through an internal promise queue.
- [x] Test two concurrent provider connects, which previously could drop one credential.

### Task 4: Surface degradation

- [x] Widen the `secure_storage_unavailable` diagnostic beyond Linux and make its message describe the actual cause.
- [x] Log the storage decision and any issue during `bootstrap()`.

### Task 5: Verify

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm docs:check` on Node 22.22.1.

## Deliberate non-goals

- **Lazy keychain probing.** Probing at startup keeps the provider list honest and does not
  re-prompt on a signed build. Recorded in the policy doc with the conditions that would
  justify revisiting it.
- **Distinguishing "no credential" from "credential present but undecryptable".** Degraded
  storage already produces a visible diagnostic, and the typed-error refactor would change
  `withApiKey`'s contract for limited gain.
- **Zeroing plaintext.** Not possible for JavaScript strings; contained by never exposing
  the value outside the main process.
