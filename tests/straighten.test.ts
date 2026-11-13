import { describe, expect, it } from "bun:test"
import { MAX_STRAIGHTEN_DEGREES, clampStraightenDegrees, resolveStraightenSize } from "../src/index"

const size = { width: 400, height: 200 }

describe("straighten", () => {
  it("keeps the tilt within its range", () => {
    expect(clampStraightenDegrees(90)).toBe(MAX_STRAIGHTEN_DEGREES)
    expect(clampStraightenDegrees(-90)).toBe(-MAX_STRAIGHTEN_DEGREES)
    expect(clampStraightenDegrees(12.5)).toBe(12.5)
    expect(clampStraightenDegrees(Number.NaN)).toBe(0)
  })

  it("leaves an untilted picture at its size", () => {
    expect(resolveStraightenSize(size, 0)).toEqual(size)
    expect(resolveStraightenSize(size, 0, "expand")).toEqual(size)
  })

  it("trims to the largest upright rectangle of the same shape", () => {
    const trimmed = resolveStraightenSize(size, 10)
    // s = min(w / (w·cos + h·sin), h / (w·sin + h·cos)) with w = 400, h = 200.
    const radians = (10 * Math.PI) / 180
    const scale = Math.min(400 / (400 * Math.cos(radians) + 200 * Math.sin(radians)), 200 / (400 * Math.sin(radians) + 200 * Math.cos(radians)))
    expect(trimmed).toEqual({ width: Math.floor(400 * scale), height: Math.floor(200 * scale) })
    expect(trimmed.width).toBeLessThan(400)
    expect(Math.abs(trimmed.width / trimmed.height - 2)).toBeLessThan(0.02)
    expect(resolveStraightenSize(size, -10)).toEqual(trimmed)
  })

  it("every corner of the trimmed rectangle stays inside the tilted picture", () => {
    for (const degrees of [1, 7, 20, 33, 45]) {
      const trimmed = resolveStraightenSize(size, degrees)
      const radians = (degrees * Math.PI) / 180
      // Turn the corner back by the tilt and compare with the picture's half-extents.
      const x = Math.abs((trimmed.width / 2) * Math.cos(radians)) + Math.abs((trimmed.height / 2) * Math.sin(radians))
      const y = Math.abs((trimmed.width / 2) * Math.sin(radians)) + Math.abs((trimmed.height / 2) * Math.cos(radians))
      expect(x).toBeLessThanOrEqual(200 + 1e-6)
      expect(y).toBeLessThanOrEqual(100 + 1e-6)
    }
  })

  it("expands to the tilted picture's bounding box", () => {
    expect(resolveStraightenSize({ width: 100, height: 100 }, 45, "expand")).toEqual({ width: 142, height: 142 })
    expect(resolveStraightenSize(size, 90, "expand")).toEqual(resolveStraightenSize(size, 45, "expand"))
  })

  it("never returns an empty picture", () => {
    expect(resolveStraightenSize({ width: 1, height: 1 }, 45)).toEqual({ width: 1, height: 1 })
    expect(resolveStraightenSize({ width: 1000, height: 1 }, 45)).toEqual({ width: 1, height: 1 })
  })
})
