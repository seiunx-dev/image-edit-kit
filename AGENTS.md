# AGENTS.md

The single source of truth for AI agents and collaborators in this repository. User docs and the API overview: [README.md](README.md) ([中文](README.zh-CN.md)).

## What this repository is

A framework-free TypeScript library for editing pictures in the browser. An edit is a list of operations (`ImageEditOp`) replayed in order on the original picture with Canvas 2D. The library has no UI, no user-facing text and no runtime dependencies; hosts build their own interface on it.

Not published to npm. A release attaches the packed tarball (`dist` + `src`); hosts install it by URL.

Stack: TypeScript (`strict`, `noUncheckedIndexedAccess`), Bun for install, tests and the bundle, ESLint.

## Layout

```
src/index.ts       public exports (everything is exported from here)
src/geometry.ts    ImageSize / ImagePoint / ImageRect and helpers (intersect, drag rectangle, screen → image, simplify)
src/ops.ts         the ImageEditOp union, sizes after operations, no-op detection, parsing untrusted data
src/history.ts     undo / redo as pure functions
src/crop.ts        crop selection geometry (handles, locked ratios)
src/straighten.ts  the size a tilt leaves (trim / expand)
src/view.ts        zoom and pan geometry
src/pixels.ts      colour matrices, blur, mosaic, sharpen on plain RGBA bytes (no canvas)
src/render.ts      the Canvas 2D renderer: applyImageEditOp, renderImageEdit, canvas factory
src/export.ts      encoding (PNG / JPEG / WebP), format support, file names, download
src/load.ts        fetch + decode with fallback candidates
tests/             bun tests; tests/canvas.ts wraps @napi-rs/canvas as the canvas factory
demo/              a page with no framework wired to the library (bun run demo)
docs/releases/     release notes, one file per tag (vX.Y.Z.md), used as the release body
```

## Commands

```bash
bun install
bun run lint
bun run typecheck
bun test            # add --coverage for the table
bun run build       # dist/index.js (one ESM file) + .d.ts
bun run quality     # lint + typecheck + tests
bun run demo
```

Run `bun run quality` after a change.

## Conventions

- No framework, no DOM requirement outside `saveBlob` and the default canvas factory, no user-facing strings (hosts translate), no runtime dependencies.
- Everything except the renderer, the encoder and the loader is pure: numbers in, numbers out, no canvas. Keep new geometry and pixel work that way so it can be tested without a browser.
- An operation never changes its source: `applyImageEditOp` returns a new canvas. Hosts rely on this to keep the result of the committed operations and preview a draft on top.
- Coordinates are in pixels of the picture as it is when the operation is applied. The renderer and `applyImageOpSize` must agree on the resulting size; a test compares them.
- A new operation needs: its member in `ImageEditOp` and `IMAGE_EDIT_OP_KINDS`, `applyImageOpSize` if it changes the size, `isNoopImageEditOp`, `parseImageEditOp`, the renderer case, tests for each, and a row in both READMEs.
- Canvases always come from `options.createCanvas ?? createEditCanvas`; never call `document.createElement` elsewhere.
- Pixel functions work on non-premultiplied RGBA and must not let the colour of fully transparent pixels leak (blur and mosaic average by coverage).
- Comments say what the code is for and why; no history ("previously", "now").
- Both READMEs are kept in step.
- Public repository: nothing about internal infrastructure in code, docs, commits or release notes.

## Tests

`bun test` runs everything. The renderer is tested on `@napi-rs/canvas`, a real Canvas 2D implementation, so drawing tests compare pixels; allow a few levels of tolerance on anti-aliased edges. Keep coverage on `src/` complete: SonarCloud's gate asks for 80% on new code.

## Git commits

```text
[Type] Short description starting with capital letter
```

| Type | Usage |
|---|---|
| `[Feat]` | New feature or capability |
| `[Fix]` | Bug fix |
| `[Perf]` | Performance improvement |
| `[Chore]` | Maintenance, refactoring, dependency, build or CI changes |
| `[Docs]` | Documentation-only changes |

Imperative mood, capitalized, no trailing period, about 70 characters at most.

## Releases

1. Bump `version` in `package.json` (patch for fixes, minor for features while 0.x) and add `docs/releases/vX.Y.Z.md`.
2. Merge to `main` and wait for `CI OK`.
3. Push the tag `vX.Y.Z`. `release.yml` checks the tag against `package.json`, waits for `CI OK` on the tagged commit, packs the tarball and creates the release with it.
