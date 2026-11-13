import { describe, expect, it } from "bun:test"
import {
  IDENTITY_COLOR_MATRIX,
  adjustmentColorMatrix,
  applyColorMatrix,
  blurPixels,
  combineColorMatrices,
  filterColorMatrix,
  hasAdjustment,
  isIdentityColorMatrix,
  pixelatePixels,
  sharpenPixels,
  type PixelBuffer,
} from "../src/index"

function buffer(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(fill(x, y), (y * width + x) * 4)
    }
  }
  return { data, width, height }
}

function pixel(pixels: PixelBuffer, x: number, y: number): number[] {
  const index = (y * pixels.width + x) * 4
  return Array.from(pixels.data.slice(index, index + 4))
}

function one(rgba: [number, number, number, number]): PixelBuffer {
  return buffer(1, 1, () => rgba)
}

describe("colour matrices", () => {
  it("leaves the picture alone with no adjustment", () => {
    expect(isIdentityColorMatrix(adjustmentColorMatrix({}))).toBe(true)
    expect(isIdentityColorMatrix(adjustmentColorMatrix({ brightness: 0, hue: Number.NaN }))).toBe(true)
    expect(hasAdjustment({})).toBe(false)
    expect(hasAdjustment({ temperature: -1 })).toBe(true)
    const pixels = one([10, 20, 30, 40])
    expect(applyColorMatrix(pixels, IDENTITY_COLOR_MATRIX)).toBe(pixels)
    expect(pixel(pixels, 0, 0)).toEqual([10, 20, 30, 40])
  })

  it("brightens by multiplying, down to black and up to double", () => {
    expect(pixel(applyColorMatrix(one([100, 50, 200, 128]), adjustmentColorMatrix({ brightness: 50 })), 0, 0)).toEqual([150, 75, 255, 128])
    expect(pixel(applyColorMatrix(one([100, 50, 200, 255]), adjustmentColorMatrix({ brightness: -100 })), 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(applyColorMatrix(one([100, 50, 200, 255]), adjustmentColorMatrix({ brightness: 900 })), 0, 0)).toEqual([200, 100, 255, 255])
  })

  it("stretches contrast about mid grey", () => {
    expect(pixel(applyColorMatrix(one([100, 150, 200, 255]), adjustmentColorMatrix({ contrast: -100 })), 0, 0)).toEqual([128, 128, 128, 255])
    const more = pixel(applyColorMatrix(one([100, 150, 128, 255]), adjustmentColorMatrix({ contrast: 100 })), 0, 0)
    expect(more[0]).toBeLessThan(100)
    expect(more[1]).toBeGreaterThan(150)
  })

  it("removes and adds saturation around the luma", () => {
    const grey = pixel(applyColorMatrix(one([255, 0, 0, 255]), adjustmentColorMatrix({ saturation: -100 })), 0, 0)
    expect(grey[0]).toBe(grey[1]!)
    expect(grey[1]).toBe(grey[2]!)
    expect(grey[0]).toBe(54)
    const vivid = pixel(applyColorMatrix(one([150, 100, 100, 255]), adjustmentColorMatrix({ saturation: 100 })), 0, 0)
    expect(vivid[0]).toBeGreaterThan(150)
    expect(vivid[1]).toBeLessThan(100)
    // A grey has no colour to change.
    expect(pixel(applyColorMatrix(one([90, 90, 90, 255]), adjustmentColorMatrix({ saturation: 100 })), 0, 0)).toEqual([90, 90, 90, 255])
  })

  it("warms and cools", () => {
    expect(pixel(applyColorMatrix(one([100, 100, 100, 255]), adjustmentColorMatrix({ temperature: 100 })), 0, 0)).toEqual([140, 100, 60, 255])
    expect(pixel(applyColorMatrix(one([100, 100, 100, 255]), adjustmentColorMatrix({ temperature: -50 })), 0, 0)).toEqual([80, 100, 120, 255])
  })

  it("turns the hue and comes back after a full turn", () => {
    const turned = pixel(applyColorMatrix(one([255, 0, 0, 255]), adjustmentColorMatrix({ hue: 120 })), 0, 0)
    expect(turned[1]).toBeGreaterThan(turned[0]!)
    expect(turned[1]).toBeGreaterThan(turned[2]!)
    const back = applyColorMatrix(applyColorMatrix(one([200, 80, 40, 255]), adjustmentColorMatrix({ hue: 180 })), adjustmentColorMatrix({ hue: -180 }))
    expect(pixel(back, 0, 0).map((value, index) => Math.abs(value - [200, 80, 40, 255][index]!) <= 2)).toEqual([true, true, true, true])
  })

  it("applies the controls in their fixed order as one matrix", () => {
    const combined = adjustmentColorMatrix({ contrast: 40, brightness: -20, temperature: 30 })
    const stepwise = combineColorMatrices(
      combineColorMatrices(adjustmentColorMatrix({ contrast: 40 }), adjustmentColorMatrix({ brightness: -20 })),
      adjustmentColorMatrix({ temperature: 30 }),
    )
    combined.forEach((value, index) => expect(value).toBeCloseTo(stepwise[index]!, 9))
    const direct = pixel(applyColorMatrix(one([120, 60, 200, 255]), combined), 0, 0)
    const chained = one([120, 60, 200, 255])
    applyColorMatrix(chained, adjustmentColorMatrix({ contrast: 40 }))
    applyColorMatrix(chained, adjustmentColorMatrix({ brightness: -20 }))
    applyColorMatrix(chained, adjustmentColorMatrix({ temperature: 30 }))
    pixel(chained, 0, 0).forEach((value, index) => expect(Math.abs(value - direct[index]!)).toBeLessThanOrEqual(1))
  })

  it("has the named looks, scaled by their amount", () => {
    expect(pixel(applyColorMatrix(one([10, 100, 250, 200]), filterColorMatrix("invert")), 0, 0)).toEqual([245, 155, 5, 200])
    expect(pixel(applyColorMatrix(one([10, 100, 250, 200]), filterColorMatrix("invert", 0)), 0, 0)).toEqual([10, 100, 250, 200])
    const grey = pixel(applyColorMatrix(one([255, 0, 0, 255]), filterColorMatrix("grayscale")), 0, 0)
    expect(grey).toEqual([54, 54, 54, 255])
    const half = pixel(applyColorMatrix(one([255, 0, 0, 255]), filterColorMatrix("grayscale", 0.5)), 0, 0)
    expect(half[0]).toBeGreaterThan(half[1]!)
    expect(half[1]).toBeGreaterThan(0)
    expect(pixel(applyColorMatrix(one([255, 255, 255, 255]), filterColorMatrix("sepia")), 0, 0)).toEqual([255, 255, 239, 255])
    expect(isIdentityColorMatrix(filterColorMatrix("sepia", 0))).toBe(true)
    expect(filterColorMatrix("sepia", Number.NaN)).toEqual(filterColorMatrix("sepia", 1))
  })
})

describe("blurPixels", () => {
  it("does nothing without a radius", () => {
    const pixels = buffer(4, 4, (x) => [x * 60, 0, 0, 255])
    const before = Array.from(pixels.data)
    expect(blurPixels(pixels, 0)).toBe(pixels)
    blurPixels(pixels, Number.NaN)
    expect(Array.from(pixels.data)).toEqual(before)
    expect(blurPixels({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, 5).data).toHaveLength(0)
  })

  it("keeps a flat picture flat, edges included", () => {
    const pixels = blurPixels(buffer(9, 7, () => [80, 120, 200, 255]), 6)
    for (let index = 0; index < pixels.data.length; index += 4) {
      expect(Array.from(pixels.data.slice(index, index + 4))).toEqual([80, 120, 200, 255])
    }
  })

  it("keeps a flat half-transparent picture as it is, to within rounding", () => {
    const pixels = blurPixels(buffer(9, 7, () => [80, 120, 200, 128]), 6)
    for (let index = 0; index < pixels.data.length; index += 4) {
      const [r, g, b, a] = pixels.data.slice(index, index + 4)
      expect(a).toBe(128)
      expect(Math.abs(r! - 80) <= 2 && Math.abs(g! - 120) <= 2 && Math.abs(b! - 200) <= 2).toBe(true)
    }
  })

  it("spreads a bright spot into its neighbours and keeps the total close", () => {
    const pixels = blurPixels(buffer(21, 21, (x, y) => (x === 10 && y === 10 ? [255, 255, 255, 255] : [0, 0, 0, 255])), 4)
    expect(pixel(pixels, 10, 10)[0]).toBeLessThan(60)
    expect(pixel(pixels, 12, 10)[0]).toBeGreaterThan(0)
    expect(pixel(pixels, 10, 12)[0]).toBe(pixel(pixels, 12, 10)[0]!)
    expect(pixel(pixels, 0, 0)[0]).toBe(0)
  })

  it("softens an edge more with a larger radius", () => {
    const edge = () => buffer(40, 1, (x) => (x < 20 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
    const small = blurPixels(edge(), 2)
    const large = blurPixels(edge(), 12)
    expect(pixel(small, 14, 0)[0]).toBeLessThan(pixel(large, 14, 0)[0]!)
    expect(pixel(large, 0, 0)[0]).toBeLessThan(pixel(large, 39, 0)[0]!)
  })

  it("does not let the colour hidden under transparent pixels bleed out", () => {
    // Opaque red next to fully transparent green: the blurred edge stays red.
    const pixels = blurPixels(buffer(20, 1, (x) => (x < 10 ? [255, 0, 0, 255] : [0, 255, 0, 0])), 4)
    const edge = pixel(pixels, 10, 0)
    expect(edge[3]).toBeGreaterThan(0)
    expect(edge[3]).toBeLessThan(255)
    expect(edge[0]).toBeGreaterThan(240)
    expect(edge[1]).toBeLessThan(15)
    expect(pixel(pixels, 19, 0)).toEqual([0, 0, 0, 0])
  })
})

describe("pixelatePixels", () => {
  it("does nothing for blocks smaller than two pixels", () => {
    const pixels = buffer(4, 1, (x) => [x * 50, 0, 0, 255])
    const before = Array.from(pixels.data)
    pixelatePixels(pixels, 1)
    pixelatePixels(pixels, Number.NaN)
    expect(Array.from(pixels.data)).toEqual(before)
  })

  it("gives every block its average colour, partial blocks at the edges included", () => {
    const pixels = pixelatePixels(buffer(5, 2, (x) => [x * 10, 0, 0, 255]), 2)
    expect(pixel(pixels, 0, 0)).toEqual([5, 0, 0, 255])
    expect(pixel(pixels, 1, 1)).toEqual([5, 0, 0, 255])
    expect(pixel(pixels, 2, 0)).toEqual([25, 0, 0, 255])
    expect(pixel(pixels, 4, 1)).toEqual([40, 0, 0, 255])
  })

  it("averages by coverage, so transparent pixels do not darken a block", () => {
    const pixels = pixelatePixels(buffer(2, 1, (x) => (x === 0 ? [200, 100, 0, 255] : [0, 0, 0, 0])), 2)
    expect(pixel(pixels, 0, 0)).toEqual([200, 100, 0, 128])
    expect(pixel(pixels, 1, 0)).toEqual([200, 100, 0, 128])
    const empty = pixelatePixels(buffer(2, 2, () => [9, 9, 9, 0]), 2)
    expect(pixel(empty, 0, 0)).toEqual([0, 0, 0, 0])
  })
})

describe("sharpenPixels", () => {
  it("does nothing at zero and leaves flat areas flat", () => {
    const flat = buffer(4, 4, () => [100, 110, 120, 200])
    expect(sharpenPixels(flat, 0)).toBe(flat)
    sharpenPixels(flat, 100)
    expect(pixel(flat, 0, 0)).toEqual([100, 110, 120, 200])
    expect(pixel(flat, 2, 2)).toEqual([100, 110, 120, 200])
    expect(sharpenPixels({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, 50).data).toHaveLength(0)
  })

  it("pushes the two sides of an edge apart and keeps alpha", () => {
    const pixels = sharpenPixels(buffer(6, 1, (x) => (x < 3 ? [100, 100, 100, 77] : [150, 150, 150, 77])), 50)
    expect(pixel(pixels, 2, 0)).toEqual([75, 75, 75, 77])
    expect(pixel(pixels, 3, 0)).toEqual([175, 175, 175, 77])
    expect(pixel(pixels, 0, 0)).toEqual([100, 100, 100, 77])
  })
})
