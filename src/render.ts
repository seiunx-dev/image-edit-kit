/**
 * Draws an edit with Canvas 2D. The original picture is never changed: every
 * operation produces a new canvas, so the result of the operations so far can
 * be kept and a draft operation previewed on top of it.
 *
 * The canvases come from a factory, so the same code runs in a page
 * (`HTMLCanvasElement`), a worker (`OffscreenCanvas`) or on a server (any
 * canvas with the standard 2D API, passed as `createCanvas`).
 */

import { intersectImageRect, type ImagePoint, type ImageRect, type ImageSize } from "./geometry"
import {
  MIN_PIXELATE_SIZE,
  isNeutralAdjustment,
  resolveCropRect,
  resolveResizeSize,
  type ImageEditOp,
} from "./ops"
import {
  adjustmentColorMatrix,
  applyColorMatrix,
  blurPixels,
  filterColorMatrix,
  pixelatePixels,
  sharpenPixels,
  type PixelBuffer,
} from "./pixels"
import { clampStraightenDegrees, resolveStraightenSize } from "./straighten"

export type EditCanvas = HTMLCanvasElement | OffscreenCanvas
export type EditContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
/** Anything that can be drawn and knows its size. */
export type ImageSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas
export type CanvasFactory = (width: number, height: number) => EditCanvas

export type RenderOptions = {
  /** Where new canvases come from. Defaults to `createEditCanvas`. */
  createCanvas?: CanvasFactory
}

/** A canvas element in a page, an `OffscreenCanvas` anywhere else that has one. */
export function createEditCanvas(width: number, height: number): EditCanvas {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    return canvas
  }
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height)
  }
  throw new Error("image-edit-kit: no canvas is available here, pass `createCanvas`")
}

export function getEditContext(canvas: EditCanvas): EditContext {
  const context = (canvas as HTMLCanvasElement).getContext("2d") as EditContext | null
  if (!context) {
    throw new Error("image-edit-kit: the canvas has no 2D context")
  }
  return context
}

/** A source's size in its own pixels (an `<img>` reports its natural size). */
export function imageSourceSize(source: ImageSource): ImageSize {
  if ("naturalWidth" in source && source.naturalWidth > 0) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  return { width: source.width, height: source.height }
}

function blank(size: ImageSize, options: RenderOptions | undefined): { canvas: EditCanvas; context: EditContext } {
  const canvas = (options?.createCanvas ?? createEditCanvas)(size.width, size.height)
  return { canvas, context: getEditContext(canvas) }
}

/** A new canvas holding the source as it is. */
export function copyImageSource(source: ImageSource, options?: RenderOptions): EditCanvas {
  const size = imageSourceSize(source)
  const { canvas, context } = blank(size, options)
  context.drawImage(source, 0, 0, size.width, size.height)
  return canvas
}

function smooth(context: EditContext): void {
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"
}

/**
 * Resamples to `target`. Shrinking to less than half goes down in halves
 * first: one large step skips most of the source pixels and leaves jagged
 * edges.
 */
function resample(source: ImageSource, size: ImageSize, target: ImageSize, options: RenderOptions | undefined): EditCanvas {
  let current: ImageSource = source
  let currentSize = size
  while (currentSize.width / 2 > target.width && currentSize.height / 2 > target.height) {
    const half = { width: Math.ceil(currentSize.width / 2), height: Math.ceil(currentSize.height / 2) }
    const step = blank(half, options)
    smooth(step.context)
    step.context.drawImage(current, 0, 0, currentSize.width, currentSize.height, 0, 0, half.width, half.height)
    current = step.canvas
    currentSize = half
  }
  const { canvas, context } = blank(target, options)
  smooth(context)
  context.drawImage(current, 0, 0, currentSize.width, currentSize.height, 0, 0, target.width, target.height)
  return canvas
}

function withPixels(
  source: ImageSource,
  rect: ImageRect | undefined,
  options: RenderOptions | undefined,
  change: (pixels: PixelBuffer) => void,
): EditCanvas {
  const canvas = copyImageSource(source, options)
  const region = intersectImageRect(rect ?? { x: 0, y: 0, width: canvas.width, height: canvas.height }, canvas)
  if (!region) {
    return canvas
  }
  const context = getEditContext(canvas)
  const pixels = context.getImageData(region.x, region.y, region.width, region.height)
  change(pixels)
  context.putImageData(pixels, region.x, region.y)
  return canvas
}

function tracePoints(context: EditContext, points: readonly ImagePoint[]): void {
  const first = points[0]!
  context.beginPath()
  context.moveTo(first.x, first.y)
  if (points.length === 2) {
    context.lineTo(points[1]!.x, points[1]!.y)
    return
  }
  // Through the midpoints, each point bending the line: a smooth curve from the samples of a drag.
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]!
    const next = points[index + 1]!
    context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2)
  }
  const last = points[points.length - 1]!
  context.lineTo(last.x, last.y)
}

function drawStroke(context: EditContext, op: Extract<ImageEditOp, { kind: "stroke" }>): void {
  const first = op.points[0]
  if (!first || !(op.width > 0)) {
    return
  }
  context.globalAlpha = op.opacity == null ? 1 : Math.min(1, Math.max(0, op.opacity))
  if (op.points.length === 1) {
    context.fillStyle = op.color
    context.beginPath()
    context.arc(first.x, first.y, op.width / 2, 0, Math.PI * 2)
    context.fill()
    return
  }
  context.strokeStyle = op.color
  context.lineWidth = op.width
  context.lineCap = "round"
  context.lineJoin = "round"
  tracePoints(context, op.points)
  context.stroke()
}

/** The length of an arrow's head for a line of `width`. */
export function arrowHeadLength(width: number): number {
  return Math.max(10, width * 4)
}

function drawShape(context: EditContext, op: Extract<ImageEditOp, { kind: "shape" }>): void {
  const { from, to } = op
  const stroked = op.width > 0
  context.strokeStyle = op.color
  context.lineWidth = op.width
  context.lineJoin = "round"
  if (op.shape === "line" || op.shape === "arrow") {
    if (!stroked) {
      return
    }
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    context.lineCap = "round"
    if (op.shape === "line" || length === 0) {
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.stroke()
      return
    }
    const head = Math.min(arrowHeadLength(op.width), length)
    const ux = (to.x - from.x) / length
    const uy = (to.y - from.y) / length
    // The shaft stops inside the head, so its round end does not blunt the tip.
    const baseX = to.x - ux * head
    const baseY = to.y - uy * head
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(baseX + ux * Math.min(op.width, head) * 0.5, baseY + uy * Math.min(op.width, head) * 0.5)
    context.stroke()
    const half = head * 0.45
    context.fillStyle = op.color
    context.beginPath()
    context.moveTo(to.x, to.y)
    context.lineTo(baseX - uy * half, baseY + ux * half)
    context.lineTo(baseX + uy * half, baseY - ux * half)
    context.closePath()
    context.fill()
    return
  }
  const left = Math.min(from.x, to.x)
  const top = Math.min(from.y, to.y)
  const width = Math.abs(to.x - from.x)
  const height = Math.abs(to.y - from.y)
  context.beginPath()
  if (op.shape === "rect") {
    context.rect(left, top, width, height)
  } else {
    context.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
  }
  if (op.fill) {
    context.fillStyle = op.fill
    context.fill()
  }
  if (stroked) {
    context.stroke()
  }
}

/** Line height as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.25

function textFont(op: Extract<ImageEditOp, { kind: "text" }>): string {
  return `${op.weight ?? 600} ${op.size}px ${op.font ?? "sans-serif"}`
}

function drawText(context: EditContext, op: Extract<ImageEditOp, { kind: "text" }>): void {
  if (!(op.size > 0)) {
    return
  }
  context.font = textFont(op)
  context.textBaseline = "top"
  context.textAlign = op.align ?? "left"
  context.fillStyle = op.color
  const outline = op.outline && op.outline.width > 0 ? op.outline : null
  if (outline) {
    context.strokeStyle = outline.color
    // Half of a stroke falls inside the letters, where the fill covers it.
    context.lineWidth = outline.width * 2
    context.lineJoin = "round"
  }
  op.text.split("\n").forEach((line, index) => {
    const y = op.at.y + index * op.size * TEXT_LINE_HEIGHT
    if (outline) {
      context.strokeText(line, op.at.x, y)
    }
    context.fillText(line, op.at.x, y)
  })
}

/**
 * The box a text operation's lines take up (widest line × line count), for
 * placing it before it is drawn. Needs a canvas to measure with.
 */
export function measureImageText(op: Extract<ImageEditOp, { kind: "text" }>, options?: RenderOptions): ImageSize {
  const { context } = blank({ width: 1, height: 1 }, options)
  context.font = textFont(op)
  const lines = op.text.split("\n")
  return {
    width: Math.ceil(Math.max(0, ...lines.map((line) => context.measureText(line).width))),
    height: Math.ceil(lines.length * op.size * TEXT_LINE_HEIGHT),
  }
}

function drawOver(source: ImageSource, options: RenderOptions | undefined, draw: (context: EditContext) => void): EditCanvas {
  const canvas = copyImageSource(source, options)
  const context = getEditContext(canvas)
  context.save()
  draw(context)
  context.restore()
  return canvas
}

/** One operation applied to `source`, on a new canvas. `source` is left as it is. */
export function applyImageEditOp(source: ImageSource, op: ImageEditOp, options?: RenderOptions): EditCanvas {
  const size = imageSourceSize(source)
  switch (op.kind) {
    case "rotate": {
      const { canvas, context } = blank({ width: size.height, height: size.width }, options)
      context.translate(canvas.width / 2, canvas.height / 2)
      context.rotate((op.turns * Math.PI) / 2)
      context.drawImage(source, -size.width / 2, -size.height / 2, size.width, size.height)
      return canvas
    }
    case "flip": {
      const { canvas, context } = blank(size, options)
      if (op.axis === "horizontal") {
        context.translate(size.width, 0)
        context.scale(-1, 1)
      } else {
        context.translate(0, size.height)
        context.scale(1, -1)
      }
      context.drawImage(source, 0, 0, size.width, size.height)
      return canvas
    }
    case "crop": {
      const rect = resolveCropRect(op.rect, size)
      if (!rect) {
        return copyImageSource(source, options)
      }
      const { canvas, context } = blank(rect, options)
      context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
      return canvas
    }
    case "straighten": {
      const degrees = clampStraightenDegrees(op.degrees)
      if (degrees === 0) {
        return copyImageSource(source, options)
      }
      const { canvas, context } = blank(resolveStraightenSize(size, degrees, op.fit), options)
      smooth(context)
      context.translate(canvas.width / 2, canvas.height / 2)
      context.rotate((degrees * Math.PI) / 180)
      context.drawImage(source, -size.width / 2, -size.height / 2, size.width, size.height)
      return canvas
    }
    case "resize": {
      const target = resolveResizeSize(op)
      return target.width === size.width && target.height === size.height
        ? copyImageSource(source, options)
        : resample(source, size, target, options)
    }
    case "adjust":
      return isNeutralAdjustment(op)
        ? copyImageSource(source, options)
        : withPixels(source, undefined, options, (pixels) => applyColorMatrix(pixels, adjustmentColorMatrix(op)))
    case "filter":
      return withPixels(source, undefined, options, (pixels) => applyColorMatrix(pixels, filterColorMatrix(op.name, op.amount)))
    case "blur":
      return op.radius > 0
        ? withPixels(source, op.rect, options, (pixels) => blurPixels(pixels, op.radius))
        : copyImageSource(source, options)
    case "sharpen":
      return op.amount > 0
        ? withPixels(source, undefined, options, (pixels) => sharpenPixels(pixels, op.amount))
        : copyImageSource(source, options)
    case "pixelate":
      return op.size >= MIN_PIXELATE_SIZE
        ? withPixels(source, op.rect, options, (pixels) => pixelatePixels(pixels, op.size))
        : copyImageSource(source, options)
    case "stroke":
      return drawOver(source, options, (context) => drawStroke(context, op))
    case "shape":
      return drawOver(source, options, (context) => drawShape(context, op))
    case "text":
      return drawOver(source, options, (context) => drawText(context, op))
  }
}

/** The source with every operation replayed onto it, on a new canvas. */
export function renderImageEdit(source: ImageSource, ops: readonly ImageEditOp[], options?: RenderOptions): EditCanvas {
  let current: ImageSource | null = null
  for (const op of ops) {
    current = applyImageEditOp(current ?? source, op, options)
  }
  return current ?? copyImageSource(source, options)
}

/** Draws `source` onto `target`, resizing `target` to match: for showing a rendered edit in a canvas on the page. */
export function paintImageSource(target: EditCanvas, source: ImageSource): void {
  const size = imageSourceSize(source)
  target.width = size.width
  target.height = size.height
  getEditContext(target).drawImage(source, 0, 0, size.width, size.height)
}
