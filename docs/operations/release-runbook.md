# Release runbook

**Scope:** what happens when a release is tagged, which failures are expected, and how to
recover from each. For what the artifacts are and which secrets they need, see the
[packaging section of the README](../../README.md).

## The pipeline

A `v*` tag starts the [Package desktop workflow](../../.github/workflows/package-desktop.yml):

1. **`prepare-release`** verifies the tag matches the committed version
   (`scripts/check-version-sync.mjs --tag`), then creates the release as a **draft** — or
   reuses the draft that already exists.
2. **`package`** builds macOS `arm64`, macOS `x64`, Windows `x64`, and Linux `x64`; signs and
   notarizes the macOS builds; uploads every artifact plus a `.sha256` sidecar to that draft.
3. **`publish-release`** flips the draft to published, and only then.

Nothing is public until step 3, and step 3 only runs when every platform in step 2 succeeded.

## Immutable releases are enabled

**Settings → General → Releases → Immutable releases** is on. This is free for public
repositories; attestations use the Sigstore Public Good Instance. It means a published
release cannot be altered, by anyone, including a re-run of this workflow.

Verified behavior against a published release (`gh` exit codes, not documentation):

| Action | Result |
| --- | --- |
| Upload an asset, with or without `--clobber` | **fails, exit 1** — `HTTP 422: Cannot upload assets to an immutable release.` |
| Delete or move the tag while the release exists | **fails, exit 1** — `Repository rule violations found / Cannot delete this tag` |
| Edit the title or release notes | allowed |
| Delete the release itself | allowed, and the tag then becomes deletable |

`--clobber` no longer means "replace an asset". It cannot, so a retry can never overwrite a
published download.

## Failure modes and recovery

### A platform build fails before publish

The release is still a draft, so nothing was published. Push the same tag again, or re-run the
failed job. `prepare-release` reuses the existing draft instead of replacing it, so the retry
is safe and idempotent.

### The workflow is re-run after the release was published

`prepare-release` stops before any build, with:

```
<tag> is already published, and published releases are immutable:
assets cannot be added, replaced, or deleted, and the tag cannot be moved or
deleted while the release exists. Nothing this run builds could be attached.
```

This is the expected outcome, not a broken workflow. **Publish a new patch version instead.**
Re-running is only meaningful while the release is a draft.

The guard exists to fail *early*: without it the run would spend the full matrix signing and
notarizing every platform before hitting the same wall at upload time.

### A published release is wrong

Do not try to repair it in place — nothing can be added, replaced, or removed. Fix forward by
releasing the next patch. Reserve the destructive path for a release that was published by
mistake:

```bash
gh api -X DELETE repos/sugarforever/apple-pi/releases/<release-id>   # allowed
gh api -X DELETE repos/sugarforever/apple-pi/git/refs/tags/<tag>    # only now possible
```

Deleting the release leaves the tag behind, so the tag needs its own step. Anyone who already
downloaded the artifacts still has them, which is why "fix forward" is the default.

### The version bump is wrong

`pnpm versions:check` fails in the release pull request rather than shipping, because the tag
build re-runs it. If a wrong version reaches a published release, treat it as the case above:
fix forward, never move a published tag.

### macOS notarization secrets are missing or expired

`prepare-release` runs first, so the draft is already created when `package` fails on
`Validate macOS release secrets`. The draft stays open and unpublished; fix the secret and
re-run.

## Verifying a download

From the directory containing a package, and after checking out the tag it came from:

```bash
shasum -a 256 -c apple-pi-<version>-mac-arm64.dmg.sha256
```

For macOS, confirm the artifact is signed, notarized, and stapled:

```bash
spctl -a -vvv -t exec "Apple Pi.app"      # expect: accepted, source=Notarized Developer ID
xcrun stapler validate "Apple Pi.app"     # expect: The validate action worked!
codesign -dv --verbose=4 "Apple Pi.app"   # expect: Developer ID Application, flags=…(runtime)
```

Windows artifacts are unsigned, so SmartScreen will warn until a code-signing certificate is
configured.

## Re-verifying immutability

If the repository setting is ever changed, re-check the two blocked actions with a throwaway
release. Use a tag **without** a `v` prefix so the release workflow cannot trigger on it:

```bash
gh api -X POST repos/sugarforever/apple-pi/releases \
  -f tag_name=immutability-probe -f name=immutability-probe \
  -F prerelease=true -F draft=false

gh release upload immutability-probe <some-file> --clobber   # expect exit 1, HTTP 422
gh api -X DELETE repos/sugarforever/apple-pi/git/refs/tags/immutability-probe  # expect exit 1

gh api -X DELETE repos/sugarforever/apple-pi/releases/<release-id>
gh api -X DELETE repos/sugarforever/apple-pi/git/refs/tags/immutability-probe  # now succeeds
```
