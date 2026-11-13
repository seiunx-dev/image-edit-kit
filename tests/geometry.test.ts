import { describe, expect, it } from "bun:test"
import {
  intersectImageRect,
  isFullImageRect,
  rectFromPoints,
  screenToImagePoint,
  simplifyPoints,
} from "../src/index"

const size = { width: 400, height: 200 }

describe("rectangles", () => {
  it("keeps the part of a rectangle that is inside the picture", () => {
    expect(intersectImageRect({ x: -20, y: 150, width: 100, height: 100 }, size)).toEqual({ x: 0, y: 150, width: 80, height: 50 })
    expect(intersectImageRect({ x: 10.4, y: 10.6, width: 20, height: 20 }, size)).toEqual({ x: 10, y: 11, width: 20, height: 20 })
    expect(intersectImageRect({ x: 400, y: 0, width: 50, height: 50 }, size)).toBeNull()
    expect(intersectImageRect({ x: 10, y: 10, width: 0.2, height: 40 }, size)).toBeNull()
  })

  it("builds a rectangle from a drag in any direction", () => {
    expect(rectFromPoints({ x: 300, y: 150 }, { x: 100, y: 50 }, size)).toEqual({ x: 100, y: 50, width: 200, height: 100 })
    expect(rectFromPoints({ x: -50, y: 20 }, { x: 900, y: 500 }, size)).toEqual({ x: 0, y: 20, width: 400, height: 180 })
  })

  it("knows the whole picture", () => {
    expect(isFullImageRect({ x: 0, y: 0, width: 400, height: 200 }, size)).toBe(true)
    expect(isFullImageRect({ x: 0, y: 1, width: 400, height: 199 }, size)).toBe(false)
  })
})

describe("screenToImagePoint", () => {
  const frame = { left: 100, top: 50, width: 200, height: 100 }

  it("scales a screen point into image pixels", () => {
    expect(screenToImagePoint({ x: 200, y: 100 }, frame, size)).toEqual({ x: 200, y: 100 })
    expect(screenToImagePoint({ x: 150, y: 75 }, frame, size)).toEqual({ x: 100, y: 50 })
  })

  it("stops at the picture's edges and survives an empty frame", () => {
    expect(screenToImagePoint({ x: 0, y: 900 }, frame, size)).toEqual({ x: 0, y: 200 })
    expect(screenToImagePoint({ x: 10, y: 10 }, { left: 0, top: 0, width: 0, height: 0 }, size)).toEqual({ x: 0, y: 0 })
  })
})

describe("simplifyPoints", () => {
  it("drops the points that lie on the line between their neighbours", () => {
    const line = [{ x: 0, y: 0 }, { x: 5, y: 0.2 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
    expect(simplifyPoints(line, 1)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
  })

  it("keeps a corner that is further than the tolerance", () => {
    const corner = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]
    expect(simplifyPoints(corner, 1)).toEqual(corner)
    expect(simplifyPoints(corner, 6)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }])
  })

  it("copies short lines and repeated points as they are", () => {
    const two = [{ x: 1, y: 1 }, { x: 2, y: 2 }]
    const copy = simplifyPoints(two)
    expect(copy).toEqual(two)
    expect(copy[0]).not.toBe(two[0])
    expect(simplifyPoints([{ x: 1, y: 1 }, { x: 4, y: 5 }, { x: 1, y: 1 }], 1)).toHaveLength(3)
    expect(simplifyPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], 0)).toHaveLength(3)
  })
})
