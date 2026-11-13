/**
 * Pixel work on plain RGBA bytes (the layout of `ImageData`: four bytes a
 * pixel, alpha not premultiplied). Nothing here needs a canvas, so it runs in
 * a page, a worker or on a server alike. Every function changes the buffer it
 * is given and returns it.
 */

import { IMAGE_ADJUSTMENT_KEYS, MAX_BLUR_RADIUS, type ImageAdjustments, type ImageFilterName } from "./ops"

export type PixelBuffer = { data: Uint8ClampedArray; width: number; height: number }

/**
 * Three rows of four numbers: each output channel is
 * `r·m[0] + g·m[1] + b·m[2] + m[3]` (the last one is an offset in levels,
 * 0 to 255). Alpha is left alone.
 */
export type ColorMatrix = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
]

export const IDENTITY_COLOR_MATRIX: ColorMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
]

/** One matrix that does what `first` then `second` would do. */
export function combineColorMatrices(first: ColorMatrix, second: ColorMatrix): ColorMatrix {
  const out: number[] = []
  for (let row = 0; row < 3; row += 1) {
    const r = second[row * 4]!
    const g = second[row * 4 + 1]!
    const b = second[row * 4 + 2]!
    for (let column = 0; column < 4; column += 1) {
      out.push(r * first[column]! + g * first[4 + column]! + b * first[8 + column]! + (column === 3 ? second[row * 4 + 3]! : 0))
    }
  }
  return out as unknown as ColorMatrix
}

export function isIdentityColorMatrix(matrix: ColorMatrix): boolean {
  return matrix.every((value, index) => Math.abs(value - IDENTITY_COLOR_MATRIX[index]!) < 1e-9)
}

// Rec. 709 luma, the weights CSS filters use.
const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

function saturationMatrix(amount: number): ColorMatrix {
  return [
    LUMA_R + (1 - LUMA_R) * amount, LUMA_G - LUMA_G * amount, LUMA_B - LUMA_B * amount, 0,
    LUMA_R - LUMA_R * amount, LUMA_G + (1 - LUMA_G) * amount, LUMA_B - LUMA_B * amount, 0,
    LUMA_R - LUMA_R * amount, LUMA_G - LUMA_G * amount, LUMA_B + (1 - LUMA_B) * amount, 0,
  ]
}

function hueMatrix(degrees: number): ColorMatrix {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928, 0,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283, 0,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072, 0,
  ]
}

/** How many levels the red and blue channels move apart at the ends of the temperature control. */
const TEMPERATURE_LEVELS = 40

function control(value: number | undefined, limit: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(limit, Math.max(-limit, value)) : 0
}

/**
 * The matrix for a set of tone controls, applied in a fixed order: hue,
 * saturation, contrast, brightness, temperature.
 *
 * - `brightness` multiplies every channel: -100 is black, 100 twice as bright.
 * - `contrast` stretches the channels about mid grey: -100 is flat grey, 100 twice the contrast.
 * - `saturation`: -100 is greyscale, 100 twice as saturated.
 * - `temperature`: positive warms the picture (more red, less blue), negative cools it.
 * - `hue` turns the colours around the colour wheel, in degrees.
 */
export function adjustmentColorMatrix(adjustments: ImageAdjustments): ColorMatrix {
  let matrix = IDENTITY_COLOR_MATRIX
  const hue = control(adjustments.hue, 180)
  if (hue !== 0) {
    matrix = combineColorMatrices(matrix, hueMatrix(hue))
  }
  const saturation = control(adjustments.saturation, 100)
  if (saturation !== 0) {
    matrix = combineColorMatrices(matrix, saturationMatrix(1 + saturation / 100))
  }
  const contrast = control(adjustments.contrast, 100)
  if (contrast !== 0) {
    const scale = 1 + contrast / 100
    const offset = 127.5 * (1 - scale)
    matrix = combineColorMatrices(matrix, [scale, 0, 0, offset, 0, scale, 0, offset, 0, 0, scale, offset])
  }
  const brightness = control(adjustments.brightness, 100)
  if (brightness !== 0) {
    const scale = 1 + brightness / 100
    matrix = combineColorMatrices(matrix, [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0])
  }
  const temperature = control(adjustments.temperature, 100)
  if (temperature !== 0) {
    const shift = (temperature / 100) * TEMPERATURE_LEVELS
    matrix = combineColorMatrices(matrix, [1, 0, 0, shift, 0, 1, 0, 0, 0, 0, 1, -shift])
  }
  return matrix
}

/** The matrix for a named look at `amount` (0 nothing, 1 full). */
export function filterColorMatrix(name: ImageFilterName, amount = 1): ColorMatrix {
  const strength = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 1
  const rest = 1 - strength
  switch (name) {
    case "grayscale":
      return saturationMatrix(rest)
    case "sepia":
      return [
        0.393 + 0.607 * rest, 0.769 - 0.769 * rest, 0.189 - 0.189 * rest, 0,
        0.349 - 0.349 * rest, 0.686 + 0.314 * rest, 0.168 - 0.168 * rest, 0,
        0.272 - 0.272 * rest, 0.534 - 0.534 * rest, 0.131 + 0.869 * rest, 0,
      ]
    case "invert": {
      const scale = 1 - 2 * strength
      const offset = 255 * strength
      return [scale, 0, 0, offset, 0, scale, 0, offset, 0, 0, scale, offset]
    }
  }
}

/** True when the tone controls hold anything the matrix would act on. */
export function hasAdjustment(adjustments: ImageAdjustments): boolean {
  return IMAGE_ADJUSTMENT_KEYS.some((key) => control(adjustments[key], key === "hue" ? 180 : 100) !== 0)
}

export function applyColorMatrix<Buffer extends PixelBuffer>(pixels: Buffer, matrix: ColorMatrix): Buffer {
  if (isIdentityColorMatrix(matrix)) {
    return pixels
  }
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11] = matrix
  const data = pixels.data
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index]!
    const g = data[index + 1]!
    const b = data[index + 2]!
    data[index] = r * m0 + g * m1 + b * m2 + m3
    data[index + 1] = r * m4 + g * m5 + b * m6 + m7
    data[index + 2] = r * m8 + g * m9 + b * m10 + m11
  }
  return pixels
}

// ---- Blur.

/** The three box widths whose repeated blur stands in for a Gaussian of `sigma`. */
function boxRadii(sigma: number): [number, number, number] {
  const passes = 3
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1)
  let lower = Math.floor(ideal)
  if (lower % 2 === 0) {
    lower -= 1
  }
  lower = Math.max(1, lower)
  const upper = lower + 2
  const lowerPasses = Math.round((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4))
  return [0, 1, 2].map((pass) => ((pass < lowerPasses ? lower : upper) - 1) / 2) as [number, number, number]
}

function boxPass(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
): void {
  const lines = horizontal ? height : width
  const length = horizontal ? width : height
  const step = horizontal ? 4 : width * 4
  const lineStep = horizontal ? width * 4 : 4
  const window = radius * 2 + 1
  const last = length - 1
  for (let line = 0; line < lines; line += 1) {
    const base = line * lineStep
    for (let channel = 0; channel < 4; channel += 1) {
      const start = base + channel
      let sum = source[start]! * (radius + 1)
      for (let offset = 1; offset <= radius; offset += 1) {
        sum += source[start + Math.min(offset, last) * step]!
      }
      for (let index = 0; index < length; index += 1) {
        target[start + index * step] = sum / window
        sum += source[start + Math.min(index + radius + 1, last) * step]! - source[start + Math.max(index - radius, 0) * step]!
      }
    }
  }
}

function premultiply(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length)
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3]!
    if (alpha === 255) {
      out[index] = data[index]!
      out[index + 1] = data[index + 1]!
      out[index + 2] = data[index + 2]!
    } else if (alpha !== 0) {
      out[index] = (data[index]! * alpha) / 255
      out[index + 1] = (data[index + 1]! * alpha) / 255
      out[index + 2] = (data[index + 2]! * alpha) / 255
    }
    out[index + 3] = alpha
  }
  return out
}

function unpremultiplyInto(source: Uint8ClampedArray, target: Uint8ClampedArray): void {
  for (let index = 0; index < source.length; index += 4) {
    const alpha = source[index + 3]!
    if (alpha === 255) {
      target[index] = source[index]!
      target[index + 1] = source[index + 1]!
      target[index + 2] = source[index + 2]!
    } else if (alpha === 0) {
      target[index] = 0
      target[index + 1] = 0
      target[index + 2] = 0
    } else {
      target[index] = (source[index]! * 255) / alpha
      target[index + 1] = (source[index + 1]! * 255) / alpha
      target[index + 2] = (source[index + 2]! * 255) / alpha
    }
    target[index + 3] = alpha
  }
}

/**
 * A soft (near-Gaussian) blur. `radius` is how far a pixel spreads, in
 * pixels; pixels at the border repeat outwards, so the edges do not darken,
 * and transparent pixels do not bleed their hidden colour into their
 * neighbours.
 */
export function blurPixels<Buffer extends PixelBuffer>(pixels: Buffer, radius: number): Buffer {
  const spread = Number.isFinite(radius) ? Math.min(MAX_BLUR_RADIUS, radius) : 0
  if (!(spread > 0) || pixels.width === 0 || pixels.height === 0) {
    return pixels
  }
  const current = premultiply(pixels.data)
  const scratch = new Uint8ClampedArray(current.length)
  for (const boxRadius of boxRadii(spread / 2)) {
    if (boxRadius === 0) {
      continue
    }
    boxPass(current, scratch, pixels.width, pixels.height, boxRadius, true)
    boxPass(scratch, current, pixels.width, pixels.height, boxRadius, false)
  }
  unpremultiplyInto(current, pixels.data)
  return pixels
}

// ---- Mosaic.

/** A mosaic: every `size` × `size` block takes the average colour of its pixels. */
export function pixelatePixels<Buffer extends PixelBuffer>(pixels: Buffer, size: number): Buffer {
  const block = Math.floor(size)
  if (!(block >= 2)) {
    return pixels
  }
  const { data, width, height } = pixels
  for (let top = 0; top < height; top += block) {
    const bottom = Math.min(height, top + block)
    for (let left = 0; left < width; left += block) {
      const right = Math.min(width, left + block)
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      for (let y = top; y < bottom; y += 1) {
        let index = (y * width + left) * 4
        for (let x = left; x < right; x += 1, index += 4) {
          const a = data[index + 3]!
          red += data[index]! * a
          green += data[index + 1]! * a
          blue += data[index + 2]! * a
          alpha += a
        }
      }
      const count = (bottom - top) * (right - left)
      const r = alpha > 0 ? red / alpha : 0
      const g = alpha > 0 ? green / alpha : 0
      const b = alpha > 0 ? blue / alpha : 0
      const a = alpha / count
      for (let y = top; y < bottom; y += 1) {
        let index = (y * width + left) * 4
        for (let x = left; x < right; x += 1, index += 4) {
          data[index] = r
          data[index + 1] = g
          data[index + 2] = b
          data[index + 3] = a
        }
      }
    }
  }
  return pixels
}

// ---- Sharpen.

/**
 * Sharpens edges by pushing every pixel away from the average of its four
 * neighbours. `amount` runs from 0 (nothing) to 100. Alpha is left alone.
 */
export function sharpenPixels<Buffer extends PixelBuffer>(pixels: Buffer, amount: number): Buffer {
  const strength = Number.isFinite(amount) ? Math.min(100, Math.max(0, amount)) / 100 : 0
  const { data, width, height } = pixels
  if (strength === 0 || width === 0 || height === 0) {
    return pixels
  }
  const source = new Uint8ClampedArray(data)
  const centre = 1 + 4 * strength
  const row = width * 4
  for (let y = 0; y < height; y += 1) {
    const up = y > 0 ? -row : 0
    const down = y < height - 1 ? row : 0
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const left = x > 0 ? -4 : 0
      const right = x < width - 1 ? 4 : 0
      for (let channel = 0; channel < 3; channel += 1) {
        const at = index + channel
        data[at] = source[at]! * centre
          - strength * (source[at + up]! + source[at + down]! + source[at + left]! + source[at + right]!)
      }
    }
  }
  return pixels
}
