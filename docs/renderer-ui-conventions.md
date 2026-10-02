# Renderer UI conventions

Apple Pi's renderer is a compact, text-first desktop interface. Its source of truth is the token set in [`theme/tokens.css`](../apps/desktop/src/renderer/src/theme/tokens.css), with resets in [`theme/base.css`](../apps/desktop/src/renderer/src/theme/base.css).

## Tokens

- Components read custom properties (`--color-*`, `--text-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--width-*`) and never hard-code colours, sizes, or shadows. A restyle or a new theme is an edit to `tokens.css`.
- Light and dark values live side by side in `tokens.css`; components never branch on the colour scheme.
- Use `--font-mono` for identifiers, model ids, paths, code, and numeric metadata. Long names and paths wrap with `overflow-wrap: anywhere` or truncate with the full value in `title`.

## Layout

Each feature folder under `apps/desktop/src/renderer/src/` owns its components and one stylesheet: `shell`, `sidebar`, `transcript`, `composer`, `extension-ui`, `settings`, and `menu`. `app/` wires them together, and `pi/` holds the type-only imports from Pi.

- The window has a 760×560 minimum. Content regions own their scrolling; the window body does not.
- Keep empty, loading, failure, and long-content states in the same layout as the successful state.

## Interaction rules

- Every interactive element is reachable by keyboard and shows the shared `:focus-visible` treatment.
- Menus return focus to their trigger on Escape. Icon-only controls carry an `aria-label`.
- Asynchronous status uses a polite live region; errors use `role="alert"`. Motion respects `prefers-reduced-motion`.

## Visual fixtures

`corepack pnpm --filter @apple-pi/desktop fixtures:generate` renders the static pages in [`fixtures/conversation-fixtures.tsx`](../apps/desktop/src/renderer/src/fixtures/conversation-fixtures.tsx), listed in [`visual-fixtures.json`](../apps/desktop/src/renderer/visual-fixtures.json), to `apps/desktop/out/visual-fixtures/` for review.
