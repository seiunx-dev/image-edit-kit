# image-edit-kit

Framework-free image editing for the browser, in TypeScript. [中文说明](README.zh-CN.md)

An edit is a list of operations replayed in order on the original picture, so the original is never touched, undo is dropping the last operation, and the same list always gives the same result. The library has no UI, no text and no dependencies: it gives you the operations, their geometry, a Canvas 2D renderer and the encoder, and you build whatever interface you like on top (Vue, React, Svelte or none).

- **Geometry**: quarter turns, mirroring, crop, straighten (tilt with the corners trimmed or kept), resize.
- **Tone and looks**: brightness, contrast, saturation, temperature, hue; greyscale, sepia, invert; blur, sharpen.
- **Masking**: mosaic or blur over a region.
- **Annotation**: freehand lines, straight lines, arrows, boxes, ellipses, text.
- **Export**: PNG, JPEG or WebP at a chosen quality, also as a plain format conversion (a WebP saved as JPEG), with a check for what the browser can really write.
- **Interaction maths**: crop handles with locked aspect ratios, zoom and pan, screen-to-image coordinates, undo / redo.

## Install

Not published to npm. Install the tarball attached to a [release](https://github.com/seiunx-dev/image-edit-kit/releases):

```bash
bun add https://github.com/seiunx-dev/image-edit-kit/releases/download/v0.1.0/image-edit-kit-0.1.0.tgz
# or: npm install <the same URL>
```

The package is ESM with type declarations and has no side effects, so a bundler keeps only what you import.

## Quick start

```ts
import {
  exportImageEdit,
  loadImageSource,
  paintImageSource,
  renderImageEdit,
  resolveEditedFileName,
  resolveImageFileName,
  saveBlob,
  type ImageEditOp,
} from "image-edit-kit"

const loaded = await loadImageSource(["https://example.com/card.webp"])
if (!loaded) throw new Error("the picture could not be read")

const ops: ImageEditOp[] = [
  { kind: "rotate", turns: 1 },
  { kind: "crop", rect: { x: 40, y: 40, width: 800, height: 600 } },
  { kind: "adjust", brightness: 10, contrast: 15 },
  { kind: "pixelate", size: 16, rect: { x: 20, y: 500, width: 240, height: 60 } },
]

// Show it.
paintImageSource(document.querySelector("canvas")!, renderImageEdit(loaded.bitmap, ops))

// Save it as JPEG.
const exported = await exportImageEdit(loaded.bitmap, ops, { format: "jpeg", quality: 0.9 })
saveBlob(exported.blob, resolveEditedFileName(resolveImageFileName(loaded.url), exported.format))
```

Converting a file from one format to another is the same call with no operations:

```ts
const bitmap = await createImageBitmap(file) // a WebP the user picked
const { blob } = await exportImageEdit(bitmap, [], { format: "jpeg" })
```

`bun run demo` serves a page that wires the library to plain DOM (`demo/`).

## Operations

Every coordinate is in pixels of the picture as it is when the operation is applied, that is, after the operations before it.

| `kind` | Fields | What it does |
|---|---|---|
| `rotate` | `turns: 1 \| -1` | A quarter turn, clockwise or counter-clockwise |
| `flip` | `axis: "horizontal" \| "vertical"` | Mirrors left ↔ right or top ↔ bottom |
| `crop` | `rect` | Keeps the rectangle (the part of it inside the picture) |
| `straighten` | `degrees` (-45 to 45), `fit?: "trim" \| "expand"` | Tilts about the centre. `trim` (default) keeps the largest upright rectangle of the same shape with no empty corner; `expand` keeps the whole picture and leaves the corners transparent |
| `resize` | `width`, `height` | Resamples; large reductions go down in halves to stay smooth |
| `adjust` | `brightness?`, `contrast?`, `saturation?`, `temperature?` (-100 to 100), `hue?` (-180 to 180) | Tone and colour, 0 is unchanged |
| `filter` | `name: "grayscale" \| "sepia" \| "invert"`, `amount?` (0 to 1) | A named look |
| `blur` | `radius`, `rect?` | Soft blur over the region, or the whole picture |
| `sharpen` | `amount` (0 to 100) | Sharpens edges |
| `pixelate` | `size`, `rect?` | Mosaic over the region, or the whole picture |
| `stroke` | `points`, `color`, `width`, `opacity?` | A freehand line |
| `shape` | `shape: "line" \| "arrow" \| "rect" \| "ellipse"`, `from`, `to`, `color`, `width`, `fill?` | A line, an arrow pointing at `to`, or a box / ellipse between two corners |
| `text` | `text`, `at`, `size`, `color`, `font?`, `weight?`, `italic?`, `align?`, `outline?`, `background?` | Text, `\n` starts a new line; `outline` draws a line around the letters, `background` a plate behind them |

Operations are plain JSON. `parseImageEditOps(value)` reads a list back from storage or a URL and returns `null` unless every entry is valid.

## API

### Model

| Export | Purpose |
|---|---|
| `resolveEditedImageSize(size, ops)`, `applyImageOpSize(size, op)` | The picture's size after the operations, without drawing anything |
| `isNoopImageEditOp(op, size)` | True when applying the operation would change nothing (use it to disable "Apply") |
| `parseImageEditOp`, `parseImageEditOps` | Validate untrusted data |
| `fitImageSize(size, { maxWidth, maxHeight })`, `scaleImageSize(size, factor)` | Sizes for a `resize` that keeps the shape |
| `pushImageEdit`, `undoImageEdit`, `redoImageEdit`, `resetImageEdit`, `canUndoImageEdit`, `canRedoImageEdit`, `EMPTY_IMAGE_EDIT_HISTORY` | Undo / redo as pure functions over `{ ops, undone }`; a reset can be redone step by step |

### Rendering

| Export | Purpose |
|---|---|
| `renderImageEdit(source, ops, options?)` | The source with every operation replayed, on a new canvas |
| `applyImageEditOp(source, op, options?)` | One operation, on a new canvas. Keep the canvas of the committed operations and apply a draft on top of it for a live preview |
| `paintImageSource(target, source)` | Draws a result onto a canvas on the page |
| `measureImageText(op, options?)`, `measureImageTextBox(op, options?)` | The size of a text operation's lines, and the rectangle it lands on (alignment and plate padding included) |
| `createEditCanvas(width, height)` | The default canvas factory |

`source` is an `ImageBitmap`, an `<img>`, a canvas or an `OffscreenCanvas`. `options.createCanvas` supplies the canvases: by default a canvas element in a page and an `OffscreenCanvas` in a worker. On a server, pass a factory from any library with the standard 2D API:

```ts
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { renderImageEdit } from "image-edit-kit"

const result = renderImageEdit(await loadImage("in.png") as never, ops, {
  createCanvas: (width, height) => createCanvas(width, height) as never,
})
```

### Pixels

`adjustmentColorMatrix`, `filterColorMatrix`, `combineColorMatrices`, `applyColorMatrix`, `blurPixels`, `pixelatePixels` and `sharpenPixels` work on plain RGBA bytes (`{ data, width, height }`, the layout of `ImageData`) and need no canvas.

### Export

| Export | Purpose |
|---|---|
| `exportImageEdit(source, ops?, options?)` | Render and encode in one call; resolves to `{ blob, format, width, height }` |
| `encodeImageCanvas(canvas, { format, quality, background })` | Encode a canvas. JPEG has no transparency: transparent pixels show `background` (white by default) |
| `canEncodeImageFormat(format)`, `listEncodableImageFormats()` | What this browser can really write. One that cannot write WebP answers with a PNG; `exportImageEdit` reports the format the file really is |
| `resolveImageFileName(url)`, `resolveEditedFileName(name, format)`, `resolveConvertedFileName(name, format)` | `card.webp` → `card-edited.jpg` for an edit, `card.jpg` for a plain conversion |
| `saveBlob(blob, name)` | Hands the file to the browser as a download |
| `loadImageSource(candidates, options?)` | Downloads and decodes the first URL that works; resolves to `{ bitmap, blob, url }` or `null` |

### Interaction

| Export | Purpose |
|---|---|
| `initialCropRect`, `adjustCropRect`, `adjustCropRectWithAspect`, `fitCropRectToAspect`, `clampCropRect`, `CROP_HANDLES`, `CROP_ASPECTS` | A crop selection: where it starts, how dragging one of the eight handles (or the whole selection) changes it, free or locked to a ratio |
| `zoomImageView`, `clampImagePan`, `clampImageZoom`, `IMAGE_VIEW_FIT` | Zoom about a point and pan, never leaving the stage's edge behind |
| `screenToImagePoint(point, frame, size)` | A pointer position as a point of the picture |
| `rectFromPoints(from, to, size)` | The region between the two ends of a drag |
| `simplifyPoints(points, tolerance)` | Thins the samples of a freehand drag |
| `resolveStraightenSize(size, degrees, fit)` | The size a tilt leaves |

## Development

```bash
bun install
bun run quality   # lint, typecheck, tests
bun run build     # dist/index.js and type declarations
bun run demo
```

The tests run the renderer on a real Canvas 2D implementation (`@napi-rs/canvas`).

## License

[MIT](LICENSE)
