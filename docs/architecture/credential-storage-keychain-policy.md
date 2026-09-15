# Credential Storage and Keychain Policy

**Status:** Enforced
**Date:** 2026-09-15
**Scope:** How Apple Pi protects provider API keys, and why the macOS keychain prompt is expected

## The rule

Never make Apple Pi bypass the operating system keychain. Specifically, do not add:

- the Chromium `use-mock-keychain` command-line switch,
- `safeStorage.setUsePlainTextEncryption(true)`,
- any fallback that writes credentials in plaintext when encryption is unavailable.

`apps/desktop/src/shared/security-policy.test.ts` fails the build if either API appears
in the main process, so this policy is enforced rather than merely documented.

## Why the mock keychain is harmful here

### What it is

Electron's `safeStorage` is backed by Chromium's OSCrypt, which derives its encryption key
from a keychain item named `<app name> Safe Storage`. Two escape hatches exist:

- `use-mock-keychain` replaces the real keychain with Chromium's `MockKeychain`, which
  returns a hardcoded password.
- `safeStorage.setUsePlainTextEncryption(true)` makes Linux use the well-known `peanuts`
  key instead of a real secret-service backend.

### Why it exists

Both are development and CI affordances. They let Chromium's own test suites and headless
build machines exercise code paths that would otherwise block on a keychain that does not
exist, and they avoid prompts in automated environments. They are not a production
security feature.

They are also unnecessary here. `CredentialBroker` takes a `ProtectedStorage` interface as
a constructor argument, so tests already substitute a fake (`FakeStorage` in
`credential-broker.test.ts`). The switch is not needed even for testing.

### Why it is dangerous in this app

The failure mode is silent, which is what makes it worse than plaintext:

1. `MockKeychain` does **not** make `safeStorage.isEncryptionAvailable()` return `false`.
   It keeps returning `true` while encrypting with a well-known constant.
2. `storagePolicy` therefore still reports `persistent`, and `CredentialBroker` keeps
   writing `credentials.json` exactly as before.
3. The result is a file on disk that the UI presents as "securely stored", encrypted with a
   key any reader can reproduce.

Provider API keys are billable credentials. Turning their protection from "the OS keychain"
into "obfuscation" without changing a single byte of the UI is the worst possible outcome,
and it is exactly the regression that a future contributor might introduce while trying to
be helpful about an alarming-looking prompt.

### Never "fix" the prompt this way

See the next section. The prompt is a symptom of an unsigned or renamed build, not of a
misconfiguration, and the app already has a legitimate fix for it.

## The macOS prompt is expected behaviour

On macOS, the first credential write (and the first launch after the app's code signature
changes) shows:

> Apple Pi wants to use your confidential information stored in "… Safe Storage" in your keychain.

This prompt comes from the credential broker's use of `safeStorage`, not from a network
request. The entered password is consumed by the keychain handshake and never reaches
application code, and nothing is transmitted off the machine.

### Legitimate ways to stop it reappearing

- **Sign releases with a stable Developer ID.** The keychain access control list is bound
  to the code signature, so an ad-hoc or changing signature invalidates it on every build.
  Tag builds are signed and notarized by the package workflow; local `package:mac` builds
  are not, so they will re-prompt after each rebuild.
- **Do not rename the application or change `appId`.** These invalidate the existing grant
  through two different paths: renaming changes the keychain item itself (`<app name> Safe
  Storage`), while changing `appId` leaves the item name alone but changes the
  `CFBundleIdentifier` baked into the code signature's designated requirement, which is what
  the keychain's access control list actually matches against. Either one makes macOS treat
  the app as a stranger to a grant it already holds, and the user gets prompted again.
- Clicking **Always Allow** records the decision for the current signature. **Deny** is not
  remembered, and the prompt returns on the next launch.

A remaining question is whether to probe the keychain lazily, so that a user who has never
saved a key is never prompted at all. That is deliberately **not** done today: with a
signed build and one "Always Allow" the prompt does not reappear, and eager resolution
means the provider list can never claim a credential is available that the app cannot
actually decrypt. Revisit it if signed releases still prove noisy in practice.

## Fail closed for persistence, never for the application

A credential store that cannot be encrypted must never be a reason to refuse to start
Apple Pi. Apple Pi is still useful with pi's own provider configuration in `~/.pi/agent`,
and the broker is an additional store, so the operating system being unable to protect a
credential has to degrade gracefully:

| Condition | Decision |
| --- | --- |
| OS protection available | Persist encrypted ciphertext to `credentials.json` (mode `0600`) |
| OS protection unavailable, including a denied keychain or Linux `basic_text` | Keep credentials in memory for this session only; write nothing to disk |
| `credentials.json` cannot be parsed | Move it aside as `credentials.json.corrupt-<timestamp>`, log it, continue with an empty store |

The middle row is why `storagePolicy` no longer throws. It previously did, which turned a
denied keychain prompt — or a locked keychain — into an application that could not launch
at all, with no path back for the user. This is reachable rather than theoretical, because
Electron documents `safeStorage.isEncryptionAvailable()` as returning "true if Keychain is
available" on macOS, so a denied prompt makes it return false. Failing closed means "do not
write to disk", which session-only storage already guarantees, so degrading is both safer
and more usable. Degraded storage is surfaced as a `secure_storage_unavailable` diagnostic
and logged at startup.

Store mutations are serialized through a promise queue. Each is a read-modify-write of one
document, so two overlapping connects would otherwise both write from the same base and
silently drop a credential.

## Known limitation: plaintext lifetime in memory

JavaScript strings cannot be zeroed, so a decrypted API key exists in the main process's
heap for as long as it is in use. `withApiKey` hands the plaintext to a callback and drops
its own reference in a `finally` block, which is the best available effort in this runtime.
What actually contains the risk is that the plaintext never reaches the renderer, never
reaches a log sink (see `logger.ts` redaction), and only crosses the private stdio pipe to
the agent host.

## Application identity drives the keychain item and user data

`app.getName()` prefers a package.json `productName` and falls back to `name`. That single
string determines two things that matter for credentials:

| Derived from the app name | Value |
| --- | --- |
| Keychain item | `<app name> Safe Storage` |
| `app.getPath("userData")` | `~/Library/Application Support/<app name>` (holds `catalog.json` and `credentials.json`) |

This is why the product name is declared once, at the root of
`apps/desktop/package.json`, and why `apps/desktop/src/main/app-identity.test.ts` fails the
build if a second declaration reappears under `build`. `productName` in the electron-builder
`build` block names the `.app` bundle but never reaches the packaged `package.json`, so an
app could look correctly branded on disk while calling itself something else at runtime.

That is exactly what shipped in 0.3.0: `productName` existed only under `build`, so
`app.getName()` fell back to `name` and the app asked for **`@apple-pi/desktop Safe Storage`**.
0.3.1 moves the declaration to the root, so the item is `Apple Pi Safe Storage`.

### `appId` changed in the same release, for the same reason

0.3.0's `appId` was `works.earendil.applepi` — a leftover from an earlier personal domain,
unrelated to the Apple Pi project. It is now `verysmallwoods.applepi`. `appId` does not
change the keychain item name (that is still `Apple Pi Safe Storage`, from `productName`),
but it does change the `CFBundleIdentifier` in the code signature, which the keychain ACL
matches on. So this by itself would also force a fresh "Always Allow." Landing it in the
same release as the `productName` fix means anyone upgrading from 0.3.0 absorbs both
identity corrections as a single prompt instead of two prompts across two releases.

### Renaming the application cannot migrate credentials

Renaming is not a cosmetic change, and it is not something to leave until later:

- `userData` moves, so `catalog.json` (workspaces and default model) appears to have been
  forgotten. That file is plain JSON and can be copied across by hand.
- **`credentials.json` cannot be migrated.** Its ciphertext is encrypted with the key stored
  in the *old* keychain item. A renamed app reads a *different* keychain item, so it holds a
  different key, and the old ciphertext is permanently undecryptable. Stored provider API
  keys have to be entered again.

Plan for this before a release, not after: after 1.0 a rename costs every user their stored
credentials and their workspace list.

### Why one "Always Allow" is enough

The keychain access control list is bound to the code signature. Tag builds are signed with
a Developer ID and carry a stable bundle identifier plus team identifier, so the entry macOS
records survives version updates. Ad-hoc and local builds re-sign with a new hash each time,
which is why they prompt again after every rebuild.
