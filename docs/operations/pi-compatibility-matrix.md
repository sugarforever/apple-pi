# Pi compatibility matrix

This table records combinations that have completed the
[Pi upgrade runbook](./pi-upgrade-runbook.md). Exact matching is enforced during
the agent-host handshake; an unlisted Pi version is not supported.

| Apple Pi version | Pi version | Protocol version | Node floor | Electron | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `0.1.0` | `0.84.2` | `1` | `>=22.20.0` | `39.8.2` | Supported | [Schemas](https://github.com/sugarforever/apple-pi/pull/10), [adapter](https://github.com/sugarforever/apple-pi/pull/11), [handshake](https://github.com/sugarforever/apple-pi/pull/12), [validation](https://github.com/sugarforever/apple-pi/pull/13), [renderer](https://github.com/sugarforever/apple-pi/pull/14), [lifecycle](https://github.com/sugarforever/apple-pi/pull/15), [fixtures/CI](https://github.com/sugarforever/apple-pi/pull/16), [successful run](https://github.com/sugarforever/apple-pi/actions/runs/34780224402) |

`Supported` means the committed protocol, adapter corpus, legacy JSONL recovery,
typecheck, build, and packaged-host smoke passed for the exact versions in the
row. The evidence link is the source of truth for which additional manual or
packaging checks ran. It does not imply that planned features such as signing,
notarization, automatic updates, or a native provider-login UI exist.

For each Pi upgrade, add a row in the upgrade PR after all gates pass. Use one of
these status values:

- `Candidate`: evidence is complete on the PR but the Apple Pi release has not shipped.
- `Supported`: the combination is released or is the current release-qualified baseline.
- `Withdrawn`: a previously recorded combination was rolled back; link the rollback.

Evidence must link both the upgrade PR and its successful compatibility workflow
run. Failed experiments belong in the PR history, not as supported matrix rows.
