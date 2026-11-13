import { clampNumber, type ImageSize } from "./geometry"

/** How far a picture may be tilted either way, in degrees. */
export const MAX_STRAIGHTEN_DEGREES = 45

/**
 * What happens to the corners when a picture is tilted: `trim` keeps the
 * largest upright rectangle of the picture's own shape that the tilted
 * picture still covers (no empty corners), `expand` grows the canvas to hold
 * the whole tilted picture (the corners are left transparent).
 */
export type StraightenFit = "trim" | "expand"

export function clampStraightenDegrees(degrees: number): number {
  return Number.isFinite(degrees) ? clampNumber(degrees, -MAX_STRAIGHTEN_DEGREES, MAX_STRAIGHTEN_DEGREES) : 0
}

/** The picture's size after tilting it by `degrees`. Never smaller than one pixel a side. */
export function resolveStraightenSize(size: ImageSize, degrees: number, fit: StraightenFit = "trim"): ImageSize {
  const radians = (Math.abs(clampStraightenDegrees(degrees)) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  if (fit === "expand") {
    return {
      width: Math.max(1, Math.ceil(size.width * cos + size.height * sin - 1e-9)),
      height: Math.max(1, Math.ceil(size.width * sin + size.height * cos - 1e-9)),
    }
  }
  // An upright rectangle s·w × s·h centred on the picture stays inside the
  // tilted picture while both of its half-extents, turned back, fit.
  const scale = Math.min(
    size.width / (size.width * cos + size.height * sin),
    size.height / (size.width * sin + size.height * cos),
  )
  return {
    width: Math.max(1, Math.floor(size.width * scale + 1e-9)),
    height: Math.max(1, Math.floor(size.height * scale + 1e-9)),
  }
}
