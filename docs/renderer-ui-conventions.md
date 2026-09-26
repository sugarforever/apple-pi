# Renderer UI conventions

Apple Pi's renderer is a compact, text-first desktop interface. Its source of truth is the small token set at the top of [`styles.css`](../apps/desktop/src/renderer/src/styles.css); this page explains how those tokens and the existing reusable components should be used.

## Typography

- Use `--text-body` (14px) for conversation content and other sustained reading.
- Use `--text-ui` (13px) for labels, controls, names, and short explanatory copy.
- Use `--text-meta` (11px) for secondary metadata. The 10px styles are reserved for short uppercase section labels, counts, and compact tool/provider metadata—not prose.
- Use `--font-mono` for identifiers, model values, paths, code, and numeric metadata. Long names and paths must wrap with `overflow-wrap: anywhere` or truncate with an accessible full value such as `title`.

## Spacing and sizing

- Compose layouts from `--space-1` through `--space-5` (4, 8, 12, 16, and 24px). Add a one-off value only when optical alignment cannot use the scale.
- Interactive controls normally use `--control-height` (34px). Dense secondary icon controls may be 28–30px when they retain a visible label through `aria-label` and a clear focus ring.
- Reading and settings content use `--content-width` (620px). Conversation content may use its existing 720px measure.
- The packaged window has a 760×560 minimum. At widths through 800px the sidebar narrows to 200px, Provider master/detail stacks, and section actions stack. Content regions own their scrolling; the window body does not.

## Surfaces and state

- `--bg` is the application canvas, `--surface` is the primary contained surface, `--raised` is elevated chrome, and `--selected` marks selected or nested content. Use `--border` for separation and `--border-strong` for interactive controls.
- Use `--radius-sm` for controls, `--radius-md` for notices and compact lists, and `--radius-lg` for the composer and prominent detail surfaces.
- Use `--text-primary`, `--text-secondary`, and `--text-tertiary` in that order of emphasis. `--accent` is for focus, selection, and primary action; `--danger` is for destructive or failed states.
- Loading regions expose `aria-busy`; asynchronous status uses a polite live region; errors use `role="alert"`. Motion must remain covered by the reduced-motion rule.

## Reusable patterns

Use the primitives in [`ui-primitives.tsx`](../apps/desktop/src/renderer/src/ui-primitives.tsx) before adding feature-local copies:

- `SectionHeading` for a titled settings section with description and optional search/actions.
- `SearchField` for labelled compact filtering.
- `StatusBadge` for short state metadata, not long diagnostics.
- `IconButton` for a labelled icon-only action.
- `Notice` for compact empty, unavailable, or explanatory states.
- `ModelSelect` for grouped model selection in Settings and the composer.

Repeated feature structures remain focused components: `AppSidebar`, `ConversationView`, `ProviderSettings`, `SkillSettings`, and `SettingsShell`. Keep session/provider/Skill state and IPC ownership in their current orchestration layer; extract presentation only when more than one real consumer needs the same pattern.

## Interaction rules

- Every interactive element must be reachable by keyboard and show the shared `:focus-visible` treatment. Composite widgets additionally implement their expected keys (for example, Provider rows support Arrow Up/Down, Home, and End).
- Menus return focus to their trigger on Escape. Inline destructive actions require an explicit Yes/Cancel step; cancel returns focus to the initiating control.
- Preserve labels on icon-only controls, `aria-current` on active navigation, `aria-selected` in selectable directories, and live-region semantics in conversation and feedback surfaces.
- Keep empty, loading, failure, long-content, and unavailable-model states in the same layout as the successful state. Do not solve overflow by hiding controls or clipping readable content.

## Maintenance

Prefer extending the token set or an existing primitive only when a current repeated need justifies it. Delete selectors when their final consumer is removed, and keep `ui-contract.test.ts` focused on accessibility, layout, and component-boundary contracts rather than exact implementation text that has no product meaning.

## Visual QA fixtures

The deterministic fixture catalog lives in `apps/desktop/src/renderer/visual-fixtures.json`. Its renderer uses the real `ConversationView`, `ProviderSettings`, and `SkillSettings` presentation boundaries with static typed props; the fixture query path never calls `window.applePi`, IPC, or persistence.

Generate references with:

```sh
pnpm --filter @apple-pi/desktop fixtures:generate
```

The command builds the desktop and captures every catalog entry at 1280×800, 960×640, and 800×600 into the gitignored `apps/desktop/out/visual-fixtures`; references are generated on demand, not committed. It captures through the repository's Electron runtime and the Chrome DevTools Protocol, so no separate browser is required. Review the PNGs at 100% scale, comparing against a capture from `main` when a change affects layout. Check that text and controls stay inside the page, focus is visible in `*-focus` fixtures, loading and failure status remains legible, and narrow references preserve content scrolling. Captures force a 1× device scale, reduced motion, and software rasterization. Regenerating on the same machine can still flip single pixels by one color level along 512px raster tile seams; treat that as noise, not a visual change. Native system fonts differ between macOS, Windows, and Linux, so compare captures from the same platform.
