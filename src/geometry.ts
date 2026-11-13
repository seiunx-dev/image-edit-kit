/** Shapes shared by every module. All of them are in image pixels unless a function says otherwise. */

export type ImageSize = { width: number; height: number }
export type ImagePoint = { x: number; y: number }
export type ImageRect = { x: number; y: number; width: number; height: number }

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** True for a number above zero; false for zero, a negative number and NaN. */
export function isPositive(value: number): boolean {
  return value > 0
}

/** True when the rectangle is the whole picture (applying it would change nothing). */
export function isFullImageRect(rect: ImageRect, size: ImageSize): boolean {
  return rect.x === 0 && rect.y === 0 && rect.width === size.width && rect.height === size.height
}

/**
 * The part of `rect` that lies inside the picture, in whole pixels, or `null`
 * when nothing of it does.
 */
export function intersectImageRect(rect: ImageRect, size: ImageSize): ImageRect | null {
  const left = clampNumber(Math.round(rect.x), 0, size.width)
  const top = clampNumber(Math.round(rect.y), 0, size.height)
  const right = clampNumber(Math.round(rect.x + rect.width), 0, size.width)
  const bottom = clampNumber(Math.round(rect.y + rect.height), 0, size.height)
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null
}

/**
 * The rectangle between two points of a drag, whichever way it was dragged,
 * kept inside the picture and in whole pixels.
 */
export function rectFromPoints(from: ImagePoint, to: ImagePoint, size: ImageSize): ImageRect {
  const left = clampNumber(Math.round(Math.min(from.x, to.x)), 0, size.width)
  const top = clampNumber(Math.round(Math.min(from.y, to.y)), 0, size.height)
  const right = clampNumber(Math.round(Math.max(from.x, to.x)), 0, size.width)
  const bottom = clampNumber(Math.round(Math.max(from.y, to.y)), 0, size.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * A point on screen as a point of the picture. `frame` is where the picture
 * is drawn on screen (its bounding box, whatever the zoom): the result is
 * clamped to the picture.
 */
export function screenToImagePoint(
  screen: ImagePoint,
  frame: { left: number; top: number; width: number; height: number },
  size: ImageSize,
): ImagePoint {
  if (frame.width <= 0 || frame.height <= 0) {
    return { x: 0, y: 0 }
  }
  return {
    x: clampNumber(((screen.x - frame.left) / frame.width) * size.width, 0, size.width),
    y: clampNumber(((screen.y - frame.top) / frame.height) * size.height, 0, size.height),
  }
}

function distanceToSegment(point: ImagePoint, from: ImagePoint, to: ImagePoint): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = dx * dx + dy * dy
  if (length === 0) {
    return Math.hypot(point.x - from.x, point.y - from.y)
  }
  const along = clampNumber(((point.x - from.x) * dx + (point.y - from.y) * dy) / length, 0, 1)
  return Math.hypot(point.x - (from.x + along * dx), point.y - (from.y + along * dy))
}

/**
 * A freehand line with the points that add nothing removed
 * (Ramer–Douglas–Peucker): no remaining point is further than `tolerance`
 * pixels from the simplified line. The ends are always kept.
 */
export function simplifyPoints(points: readonly ImagePoint[], tolerance = 1): ImagePoint[] {
  if (points.length <= 2 || tolerance <= 0) {
    return points.map((point) => ({ x: point.x, y: point.y }))
  }
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const pending: [number, number][] = [[0, points.length - 1]]
  while (pending.length > 0) {
    const [start, end] = pending.pop() as [number, number]
    let furthest = -1
    let furthestDistance = tolerance
    for (let index = start + 1; index < end; index += 1) {
      const distance = distanceToSegment(points[index]!, points[start]!, points[end]!)
      if (distance > furthestDistance) {
        furthest = index
        furthestDistance = distance
      }
    }
    if (furthest !== -1) {
      keep[furthest] = 1
      pending.push([start, furthest], [furthest, end])
    }
  }
  return points.filter((_, index) => keep[index] === 1).map((point) => ({ x: point.x, y: point.y }))
}
