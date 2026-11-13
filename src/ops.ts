/**
 * An edit is a list of operations replayed in order on the original picture.
 * This module is the list's vocabulary and its geometry; it draws nothing.
 * Every coordinate is in pixels of the picture as it is when the operation is
 * applied (after the operations before it).
 */

import {
  intersectImageRect,
  isFullImageRect,
  isPositive,
  type ImagePoint,
  type ImageRect,
  type ImageSize,
} from "./geometry"
import { clampStraightenDegrees, resolveStraightenSize, type StraightenFit } from "./straighten"

/** The largest side a picture may be resized to. */
export const MAX_IMAGE_DIMENSION = 16384
/** The largest blur radius, in pixels. */
export const MAX_BLUR_RADIUS = 256
/** The smallest mosaic block, in pixels. */
export const MIN_PIXELATE_SIZE = 2

/** Every tone control runs from -100 to 100 with 0 as "unchanged"; `hue` is in degrees, -180 to 180. */
export const IMAGE_ADJUSTMENT_KEYS = ["brightness", "contrast", "saturation", "temperature", "hue"] as const
export type ImageAdjustmentKey = (typeof IMAGE_ADJUSTMENT_KEYS)[number]
export type ImageAdjustments = { [Key in ImageAdjustmentKey]?: number }

export const IMAGE_FILTER_NAMES = ["grayscale", "sepia", "invert"] as const
export type ImageFilterName = (typeof IMAGE_FILTER_NAMES)[number]

export const IMAGE_SHAPE_KINDS = ["line", "arrow", "rect", "ellipse"] as const
export type ImageShapeKind = (typeof IMAGE_SHAPE_KINDS)[number]

export const IMAGE_TEXT_ALIGNS = ["left", "center", "right"] as const
export type ImageTextAlign = (typeof IMAGE_TEXT_ALIGNS)[number]

export type ImageEditOp =
  /** A quarter turn: 1 clockwise, -1 counter-clockwise. */
  | { kind: "rotate"; turns: 1 | -1 }
  /** `horizontal` mirrors left ↔ right, `vertical` top ↔ bottom. */
  | { kind: "flip"; axis: "horizontal" | "vertical" }
  /** Keeps `rect` and drops the rest. */
  | { kind: "crop"; rect: ImageRect }
  /** Tilts the picture about its centre, clockwise for positive degrees (-45 to 45). `fit` defaults to `trim`. */
  | { kind: "straighten"; degrees: number; fit?: StraightenFit }
  /** Resamples the picture to `width` × `height`. */
  | { kind: "resize"; width: number; height: number }
  /** Tone and colour, see `IMAGE_ADJUSTMENT_KEYS`. */
  | ({ kind: "adjust" } & ImageAdjustments)
  /** A named look. `amount` runs from 0 (nothing) to 1 (full, the default). */
  | { kind: "filter"; name: ImageFilterName; amount?: number }
  /** A soft blur of `radius` pixels, over `rect` when given, else the whole picture. */
  | { kind: "blur"; radius: number; rect?: ImageRect }
  /** Sharpens edges. `amount` runs from 0 to 100. */
  | { kind: "sharpen"; amount: number }
  /** A mosaic of `size`-pixel blocks, over `rect` when given, else the whole picture. */
  | { kind: "pixelate"; size: number; rect?: ImageRect }
  /** A freehand line through `points`. `opacity` runs from 0 to 1 (the default). */
  | { kind: "stroke"; points: ImagePoint[]; color: string; width: number; opacity?: number }
  /** A straight line, an arrow pointing at `to`, or a box / ellipse between the two corners. */
  | { kind: "shape"; shape: ImageShapeKind; from: ImagePoint; to: ImagePoint; color: string; width: number; fill?: string }
  /**
   * Text whose first line starts at `at` (its top; the left, centre or right
   * of each line according to `align`). `size` is the font size in pixels,
   * `font` a CSS font family, `weight` a CSS font weight, `outline` a line
   * drawn around the letters, `background` a plate behind the lines
   * (`padding` around them and corner `radius`, in pixels; both default to a
   * fraction of the font size), `rotation` a turn about the centre of the
   * text's box, clockwise in degrees.
   */
  | {
      kind: "text"
      text: string
      at: ImagePoint
      size: number
      color: string
      font?: string
      weight?: number | string
      italic?: boolean
      align?: ImageTextAlign
      outline?: { color: string; width: number }
      background?: { color: string; padding?: number; radius?: number }
      rotation?: number
    }

export type ImageEditOpKind = ImageEditOp["kind"]

export const IMAGE_EDIT_OP_KINDS = [
  "rotate",
  "flip",
  "crop",
  "straighten",
  "resize",
  "adjust",
  "filter",
  "blur",
  "sharpen",
  "pixelate",
  "stroke",
  "shape",
  "text",
] as const satisfies readonly ImageEditOpKind[]

function clampDimension(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_IMAGE_DIMENSION, Math.max(1, Math.round(value))) : 1
}

/** The size a resize really produces: whole pixels, one to `MAX_IMAGE_DIMENSION` a side. */
export function resolveResizeSize(op: { width: number; height: number }): ImageSize {
  return { width: clampDimension(op.width), height: clampDimension(op.height) }
}

/** The rectangle a crop really keeps (the part inside the picture), or `null` when it keeps nothing or everything. */
export function resolveCropRect(rect: ImageRect, size: ImageSize): ImageRect | null {
  const inside = intersectImageRect(rect, size)
  return inside && !isFullImageRect(inside, size) ? inside : null
}

/** The picture's size after one operation. */
export function applyImageOpSize(size: ImageSize, op: ImageEditOp): ImageSize {
  switch (op.kind) {
    case "rotate":
      return { width: size.height, height: size.width }
    case "crop": {
      const rect = resolveCropRect(op.rect, size)
      return rect ? { width: rect.width, height: rect.height } : size
    }
    case "straighten":
      return clampStraightenDegrees(op.degrees) === 0 ? size : resolveStraightenSize(size, op.degrees, op.fit)
    case "resize":
      return resolveResizeSize(op)
    default:
      return size
  }
}

/** The picture's size after every operation. */
export function resolveEditedImageSize(size: ImageSize, ops: readonly ImageEditOp[]): ImageSize {
  return ops.reduce((current, op) => applyImageOpSize(current, op), size)
}

/** True when every tone control is at 0 (or missing). */
export function isNeutralAdjustment(adjustments: ImageAdjustments): boolean {
  return IMAGE_ADJUSTMENT_KEYS.every((key) => !adjustments[key])
}

/** True when a region is given and none of it lies on the picture. */
function missesPicture(rect: ImageRect | undefined, size: ImageSize): boolean {
  return rect != null && intersectImageRect(rect, size) == null
}

/** True when applying `op` to a picture of `size` would leave it as it is. */
export function isNoopImageEditOp(op: ImageEditOp, size: ImageSize): boolean {
  switch (op.kind) {
    case "rotate":
    case "flip":
      return false
    case "crop":
      return resolveCropRect(op.rect, size) == null
    case "straighten":
      return clampStraightenDegrees(op.degrees) === 0
    case "resize": {
      const next = resolveResizeSize(op)
      return next.width === size.width && next.height === size.height
    }
    case "adjust":
      return isNeutralAdjustment(op)
    case "filter":
      return op.amount != null && !isPositive(op.amount)
    case "blur":
      return !isPositive(op.radius) || missesPicture(op.rect, size)
    case "sharpen":
      return !isPositive(op.amount)
    case "pixelate":
      return Number.isNaN(op.size) || op.size < MIN_PIXELATE_SIZE || missesPicture(op.rect, size)
    case "stroke":
      return op.points.length === 0 || !isPositive(op.width) || op.opacity === 0
    case "shape":
      return !isPositive(op.width) && !op.fill
    case "text":
      return op.text.trim() === "" || !isPositive(op.size)
  }
}

/**
 * The size a picture takes when it is scaled to fit inside `maxWidth` ×
 * `maxHeight` keeping its shape. A picture that already fits is not enlarged.
 */
export function fitImageSize(size: ImageSize, bounds: { maxWidth?: number; maxHeight?: number }): ImageSize {
  const scale = Math.min(
    1,
    bounds.maxWidth != null && bounds.maxWidth > 0 ? bounds.maxWidth / size.width : 1,
    bounds.maxHeight != null && bounds.maxHeight > 0 ? bounds.maxHeight / size.height : 1,
  )
  return scaleImageSize(size, scale)
}

/** The picture's size times `factor`, in whole pixels. */
export function scaleImageSize(size: ImageSize, factor: number): ImageSize {
  return resolveResizeSize({ width: size.width * factor, height: size.height * factor })
}

// ---- Reading operations back from storage or a URL.

type Json = Record<string, unknown>
type OpOf<Kind extends ImageEditOpKind> = Extract<ImageEditOp, { kind: Kind }>

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/** A finite number of at least `min`. */
function atLeast(value: unknown, min: number): value is number {
  return finite(value) && value >= min
}

function color(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.length <= 128
}

function oneOf<const Options extends readonly unknown[]>(options: Options, value: unknown): value is Options[number] {
  return options.includes(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parsePoint(value: unknown): ImagePoint | null {
  return isRecord(value) && finite(value.x) && finite(value.y) ? { x: value.x, y: value.y } : null
}

function parsePoints(value: unknown): ImagePoint[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const points: ImagePoint[] = []
  for (const entry of value) {
    const point = parsePoint(entry)
    if (!point) {
      return null
    }
    points.push(point)
  }
  return points
}

function parseRect(value: unknown): ImageRect | null {
  return isRecord(value) && finite(value.x) && finite(value.y) && finite(value.width) && finite(value.height)
    && value.width > 0 && value.height > 0
    ? { x: value.x, y: value.y, width: value.width, height: value.height }
    : null
}

/** The optional region of a blur or a mosaic: `{}` when there is none, `null` when it is not a rectangle. */
function parseRegion(value: Json): { rect?: ImageRect } | null {
  if (value.rect == null) {
    return {}
  }
  const rect = parseRect(value.rect)
  return rect ? { rect } : null
}

/**
 * The optional fields of an operation that are copied as they are: each is
 * left out when missing and makes the whole operation invalid when it does
 * not pass its check.
 */
function parseOptions<Result>(value: Json, checks: { [Key in keyof Result]-?: (given: unknown) => boolean }): Partial<Result> | null {
  const result: Partial<Result> = {}
  for (const key of Object.keys(checks) as (keyof Result & string)[]) {
    const given = value[key]
    if (given == null) {
      continue
    }
    if (!checks[key](given)) {
      return null
    }
    result[key] = given as Result[typeof key]
  }
  return result
}

function parseRotate(value: Json): OpOf<"rotate"> | null {
  return value.turns === 1 || value.turns === -1 ? { kind: "rotate", turns: value.turns } : null
}

function parseFlip(value: Json): OpOf<"flip"> | null {
  return value.axis === "horizontal" || value.axis === "vertical" ? { kind: "flip", axis: value.axis } : null
}

function parseCrop(value: Json): OpOf<"crop"> | null {
  const rect = parseRect(value.rect)
  return rect ? { kind: "crop", rect } : null
}

function parseStraighten(value: Json): OpOf<"straighten"> | null {
  const options = parseOptions<{ fit: StraightenFit }>(value, { fit: (given) => given === "trim" || given === "expand" })
  return finite(value.degrees) && options ? { kind: "straighten", degrees: clampStraightenDegrees(value.degrees), ...options } : null
}

function parseResize(value: Json): OpOf<"resize"> | null {
  return atLeast(value.width, 1) && atLeast(value.height, 1)
    ? { kind: "resize", ...resolveResizeSize({ width: value.width, height: value.height }) }
    : null
}

function parseAdjust(value: Json): OpOf<"adjust"> | null {
  const op: OpOf<"adjust"> = { kind: "adjust" }
  for (const key of IMAGE_ADJUSTMENT_KEYS) {
    const amount = value[key]
    if (amount == null) {
      continue
    }
    if (!finite(amount)) {
      return null
    }
    const limit = key === "hue" ? 180 : 100
    op[key] = clamp(amount, -limit, limit)
  }
  return op
}

function parseFilter(value: Json): OpOf<"filter"> | null {
  const options = parseOptions<{ amount: number }>(value, { amount: finite })
  if (!oneOf(IMAGE_FILTER_NAMES, value.name) || !options) {
    return null
  }
  return { kind: "filter", name: value.name, ...(options.amount == null ? {} : { amount: clamp(options.amount, 0, 1) }) }
}

function parseBlur(value: Json): OpOf<"blur"> | null {
  const region = parseRegion(value)
  return region && atLeast(value.radius, 0) ? { kind: "blur", radius: Math.min(MAX_BLUR_RADIUS, value.radius), ...region } : null
}

function parseSharpen(value: Json): OpOf<"sharpen"> | null {
  return atLeast(value.amount, 0) ? { kind: "sharpen", amount: Math.min(100, value.amount) } : null
}

function parsePixelate(value: Json): OpOf<"pixelate"> | null {
  const region = parseRegion(value)
  return region && atLeast(value.size, MIN_PIXELATE_SIZE) ? { kind: "pixelate", size: Math.round(value.size), ...region } : null
}

function parseStroke(value: Json): OpOf<"stroke"> | null {
  const points = parsePoints(value.points)
  const options = parseOptions<{ opacity: number }>(value, { opacity: finite })
  if (!points || !options || !color(value.color) || !finite(value.width) || value.width <= 0) {
    return null
  }
  return {
    kind: "stroke",
    points,
    color: value.color,
    width: value.width,
    ...(options.opacity == null ? {} : { opacity: clamp(options.opacity, 0, 1) }),
  }
}

function parseShape(value: Json): OpOf<"shape"> | null {
  const from = parsePoint(value.from)
  const to = parsePoint(value.to)
  const options = parseOptions<{ fill: string }>(value, { fill: color })
  if (!from || !to || !options || !oneOf(IMAGE_SHAPE_KINDS, value.shape) || !color(value.color) || !atLeast(value.width, 0)) {
    return null
  }
  return { kind: "shape", shape: value.shape, from, to, color: value.color, width: value.width, ...options }
}

type TextOp = OpOf<"text">

/** A text's outline: `{}` when there is none, `null` when it is not one. */
function parseTextOutline(value: unknown): Pick<TextOp, "outline"> | null {
  if (value == null) {
    return {}
  }
  return isRecord(value) && color(value.color) && atLeast(value.width, 0)
    ? { outline: { color: value.color, width: value.width } }
    : null
}

/** A text's plate: `{}` when there is none, `null` when it is not one. */
function parseTextBackground(value: unknown): Pick<TextOp, "background"> | null {
  if (value == null) {
    return {}
  }
  if (!isRecord(value) || !color(value.color)) {
    return null
  }
  const sizes = parseOptions<{ padding: number; radius: number }>(value, {
    padding: (given) => atLeast(given, 0),
    radius: (given) => atLeast(given, 0),
  })
  return sizes ? { background: { color: value.color, ...sizes } } : null
}

function parseText(value: Json): TextOp | null {
  const at = parsePoint(value.at)
  if (!at || typeof value.text !== "string" || !finite(value.size) || value.size <= 0 || !color(value.color)) {
    return null
  }
  const style = parseOptions<Pick<TextOp, "font" | "weight" | "italic" | "align" | "rotation">>(value, {
    font: (given) => typeof given === "string" && given.length <= 256,
    weight: (given) => typeof given === "string" || finite(given),
    italic: (given) => typeof given === "boolean",
    align: (given) => oneOf(IMAGE_TEXT_ALIGNS, given),
    rotation: finite,
  })
  const outline = parseTextOutline(value.outline)
  const background = parseTextBackground(value.background)
  if (!style || !outline || !background) {
    return null
  }
  return { kind: "text", text: value.text, at, size: value.size, color: value.color, ...style, ...outline, ...background }
}

const PARSERS: { [Kind in ImageEditOpKind]: (value: Json) => OpOf<Kind> | null } = {
  rotate: parseRotate,
  flip: parseFlip,
  crop: parseCrop,
  straighten: parseStraighten,
  resize: parseResize,
  adjust: parseAdjust,
  filter: parseFilter,
  blur: parseBlur,
  sharpen: parseSharpen,
  pixelate: parsePixelate,
  stroke: parseStroke,
  shape: parseShape,
  text: parseText,
}

/** One operation from untrusted data (JSON), or `null` when it is not a valid operation. */
export function parseImageEditOp(value: unknown): ImageEditOp | null {
  return isRecord(value) && oneOf(IMAGE_EDIT_OP_KINDS, value.kind) ? PARSERS[value.kind](value) : null
}

/**
 * A list of operations from untrusted data, or `null` when the value is not a
 * list or holds anything that is not a valid operation: later operations are
 * measured on the result of earlier ones, so a list is used whole or not at
 * all.
 */
export function parseImageEditOps(value: unknown): ImageEditOp[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const ops: ImageEditOp[] = []
  for (const entry of value) {
    const op = parseImageEditOp(entry)
    if (!op) {
      return null
    }
    ops.push(op)
  }
  return ops
}
