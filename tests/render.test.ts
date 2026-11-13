import { describe, expect, it } from "bun:test"
import {
  applyImageEditOp,
  arrowHeadLength,
  copyImageSource,
  createEditCanvas,
  getEditContext,
  imageSourceSize,
  measureImageText,
  paintImageSource,
  renderImageEdit,
  resolveEditedImageSize,
  resolveStraightenSize,
  type EditCanvas,
  type ImageEditOp,
  type ImageSource,
} from "../src/index"
import { BLACK, BLUE, GREEN, RED, WHITE, createTestCanvas, options, paint, pixelAt, quadrants, sizeOf } from "./canvas"

function near(actual: number[], expected: number[], tolerance = 3): boolean {
  return actual.every((value, index) => Math.abs(value - expected[index]!) <= tolerance)
}

describe("canvases", () => {
  it("needs a factory where there is no canvas", () => {
    expect(() => createEditCanvas(2, 2)).toThrow("createCanvas")
  })

  it("uses the page's canvas element, then OffscreenCanvas, when they exist", () => {
    const globals = globalThis as { document?: unknown; OffscreenCanvas?: unknown }
    class Offscreen {
      constructor(public width: number, public height: number) {}
    }
    globals.OffscreenCanvas = Offscreen
    try {
      expect(createEditCanvas(3, 4)).toEqual(new Offscreen(3, 4) as unknown as EditCanvas)
      globals.document = { createElement: (tag: string) => ({ tag, width: 0, height: 0 }) }
      expect(createEditCanvas(5, 6) as unknown).toEqual({ tag: "canvas", width: 5, height: 6 })
    } finally {
      delete globals.document
      delete globals.OffscreenCanvas
    }
  })

  it("reports a missing 2D context", () => {
    expect(() => getEditContext({ getContext: () => null } as unknown as EditCanvas)).toThrow("2D context")
  })

  it("measures an image element by its natural size", () => {
    expect(imageSourceSize({ naturalWidth: 640, naturalHeight: 480, width: 64, height: 48 } as unknown as ImageSource)).toEqual({ width: 640, height: 480 })
    expect(imageSourceSize({ naturalWidth: 0, naturalHeight: 0, width: 64, height: 48 } as unknown as ImageSource)).toEqual({ width: 64, height: 48 })
    expect(imageSourceSize(quadrants(8, 6))).toEqual({ width: 8, height: 6 })
  })

  it("copies a source and paints one canvas onto another", () => {
    const source = quadrants(4, 4)
    const copy = copyImageSource(source, options)
    expect(copy).not.toBe(source)
    expect(pixelAt(copy, 3, 0)).toEqual(GREEN)
    const target = createTestCanvas(1, 1)
    paintImageSource(target, source)
    expect(sizeOf(target)).toEqual({ width: 4, height: 4 })
    expect(pixelAt(target, 0, 3)).toEqual(BLUE)
  })
})

describe("geometry operations", () => {
  it("turns a quarter either way", () => {
    const source = quadrants(4, 2)
    const clockwise = applyImageEditOp(source, { kind: "rotate", turns: 1 }, options)
    expect(sizeOf(clockwise)).toEqual({ width: 2, height: 4 })
    // Clockwise: the left column (red over blue) becomes the top row, blue first.
    expect(pixelAt(clockwise, 0, 0)).toEqual(BLUE)
    expect(pixelAt(clockwise, 1, 0)).toEqual(RED)
    expect(pixelAt(clockwise, 1, 3)).toEqual(GREEN)
    const counter = applyImageEditOp(source, { kind: "rotate", turns: -1 }, options)
    expect(pixelAt(counter, 0, 0)).toEqual(GREEN)
    expect(pixelAt(counter, 0, 3)).toEqual(RED)
    // The source is left as it was.
    expect(pixelAt(source, 0, 0)).toEqual(RED)
  })

  it("mirrors across either axis", () => {
    const source = quadrants(4, 4)
    const horizontal = applyImageEditOp(source, { kind: "flip", axis: "horizontal" }, options)
    expect(pixelAt(horizontal, 0, 0)).toEqual(GREEN)
    expect(pixelAt(horizontal, 3, 3)).toEqual(BLUE)
    const vertical = applyImageEditOp(source, { kind: "flip", axis: "vertical" }, options)
    expect(pixelAt(vertical, 0, 0)).toEqual(BLUE)
    expect(pixelAt(vertical, 3, 3)).toEqual(GREEN)
  })

  it("crops to the rectangle, or to the part of it inside the picture", () => {
    const source = quadrants(8, 8)
    const corner = applyImageEditOp(source, { kind: "crop", rect: { x: 4, y: 4, width: 4, height: 4 } }, options)
    expect(sizeOf(corner)).toEqual({ width: 4, height: 4 })
    expect(pixelAt(corner, 0, 0)).toEqual(WHITE)
    const overflowing = applyImageEditOp(source, { kind: "crop", rect: { x: 6, y: 2, width: 40, height: 4 } }, options)
    expect(sizeOf(overflowing)).toEqual({ width: 2, height: 4 })
    expect(pixelAt(overflowing, 0, 0)).toEqual(GREEN)
    expect(pixelAt(overflowing, 1, 3)).toEqual(WHITE)
    const outside = applyImageEditOp(source, { kind: "crop", rect: { x: 80, y: 0, width: 4, height: 4 } }, options)
    expect(sizeOf(outside)).toEqual({ width: 8, height: 8 })
  })

  it("straightens: trimmed has no empty corner, expanded keeps the whole picture", () => {
    const source = paint(60, 40, () => RED)
    const trimmed = applyImageEditOp(source, { kind: "straighten", degrees: 10 }, options)
    expect(sizeOf(trimmed)).toEqual(resolveStraightenSize({ width: 60, height: 40 }, 10))
    for (const [x, y] of [[0, 0], [trimmed.width - 1, 0], [0, trimmed.height - 1], [trimmed.width - 1, trimmed.height - 1]] as const) {
      expect(pixelAt(trimmed, x, y)[3]).toBeGreaterThan(200)
    }
    const expanded = applyImageEditOp(source, { kind: "straighten", degrees: 10, fit: "expand" }, options)
    expect(sizeOf(expanded)).toEqual(resolveStraightenSize({ width: 60, height: 40 }, 10, "expand"))
    expect(pixelAt(expanded, 0, 0)[3]).toBe(0)
    expect(near(pixelAt(expanded, Math.floor(expanded.width / 2), Math.floor(expanded.height / 2)), RED)).toBe(true)
    expect(sizeOf(applyImageEditOp(source, { kind: "straighten", degrees: 0 }, options))).toEqual({ width: 60, height: 40 })
  })

  it("tilts clockwise for positive degrees", () => {
    // Left half black, right half white. Turned 45° clockwise, the white half
    // lies towards the bottom right and the black half towards the top left.
    const source = paint(40, 40, (x) => (x < 20 ? BLACK : WHITE))
    const tilted = applyImageEditOp(source, { kind: "straighten", degrees: 45, fit: "expand" }, options)
    const centre = Math.floor(tilted.width / 2)
    expect(near(pixelAt(tilted, centre + 12, centre + 12), WHITE, 8)).toBe(true)
    expect(near(pixelAt(tilted, centre - 12, centre - 12), BLACK, 8)).toBe(true)
  })

  it("resizes, shrinking in steps", () => {
    const source = quadrants(64, 64)
    const small = applyImageEditOp(source, { kind: "resize", width: 8, height: 8 }, options)
    expect(sizeOf(small)).toEqual({ width: 8, height: 8 })
    expect(near(pixelAt(small, 1, 1), RED)).toBe(true)
    expect(near(pixelAt(small, 6, 6), WHITE)).toBe(true)
    const large = applyImageEditOp(source, { kind: "resize", width: 128, height: 32 }, options)
    expect(sizeOf(large)).toEqual({ width: 128, height: 32 })
    expect(near(pixelAt(large, 100, 4), GREEN)).toBe(true)
    expect(sizeOf(applyImageEditOp(source, { kind: "resize", width: 64, height: 64 }, options))).toEqual({ width: 64, height: 64 })
  })

  it("averages fine detail away instead of sampling it when shrinking a lot", () => {
    // One-pixel black and white stripes shrunk to an eighth: a clean mid grey, no moiré.
    const stripes = paint(64, 64, (x) => (x % 2 === 0 ? BLACK : WHITE))
    const small = applyImageEditOp(stripes, { kind: "resize", width: 8, height: 8 }, options)
    for (let x = 1; x < 7; x += 1) {
      expect(Math.abs(pixelAt(small, x, 4)[0]! - 128)).toBeLessThan(24)
    }
  })
})

describe("pixel operations", () => {
  it("adjusts tone over the whole picture", () => {
    const source = paint(4, 4, () => [100, 100, 100, 255])
    expect(pixelAt(applyImageEditOp(source, { kind: "adjust", brightness: 50 }, options), 2, 2)).toEqual([150, 150, 150, 255])
    expect(pixelAt(applyImageEditOp(source, { kind: "adjust" }, options), 2, 2)).toEqual([100, 100, 100, 255])
    expect(pixelAt(source, 2, 2)).toEqual([100, 100, 100, 255])
  })

  it("applies a named look", () => {
    const source = quadrants(4, 4)
    const inverted = applyImageEditOp(source, { kind: "filter", name: "invert" }, options)
    expect(pixelAt(inverted, 0, 0)).toEqual([0, 255, 255, 255])
    const grey = applyImageEditOp(source, { kind: "filter", name: "grayscale", amount: 1 }, options)
    expect(pixelAt(grey, 0, 0)).toEqual([54, 54, 54, 255])
  })

  it("blurs the whole picture or only a region", () => {
    const source = paint(40, 20, (x) => (x < 20 ? BLACK : WHITE))
    const all = applyImageEditOp(source, { kind: "blur", radius: 6 }, options)
    expect(pixelAt(all, 18, 10)[0]).toBeGreaterThan(20)
    expect(pixelAt(all, 21, 10)[0]).toBeLessThan(235)
    const region = applyImageEditOp(source, { kind: "blur", radius: 6, rect: { x: 10, y: 0, width: 20, height: 10 } }, options)
    expect(pixelAt(region, 18, 5)[0]).toBeGreaterThan(20)
    // Below the region the edge is as sharp as before.
    expect(pixelAt(region, 19, 15)).toEqual(BLACK)
    expect(pixelAt(region, 20, 15)).toEqual(WHITE)
    expect(pixelAt(applyImageEditOp(source, { kind: "blur", radius: 0 }, options), 19, 10)).toEqual(BLACK)
    expect(pixelAt(applyImageEditOp(source, { kind: "blur", radius: 6, rect: { x: 100, y: 0, width: 5, height: 5 } }, options), 19, 10)).toEqual(BLACK)
  })

  it("puts a mosaic over a region and leaves the rest alone", () => {
    const source = paint(16, 16, (x, y) => ((x + y) % 2 === 0 ? BLACK : WHITE))
    const mosaic = applyImageEditOp(source, { kind: "pixelate", size: 4, rect: { x: 0, y: 0, width: 8, height: 8 } }, options)
    expect(near(pixelAt(mosaic, 1, 1), [128, 128, 128, 255], 1)).toBe(true)
    expect(pixelAt(mosaic, 1, 1)).toEqual(pixelAt(mosaic, 2, 3))
    expect(pixelAt(mosaic, 8, 0)).toEqual(BLACK)
    expect(pixelAt(mosaic, 9, 0)).toEqual(WHITE)
    expect(pixelAt(applyImageEditOp(source, { kind: "pixelate", size: 1 }, options), 1, 0)).toEqual(WHITE)
  })

  it("sharpens edges", () => {
    const source = paint(8, 4, (x) => (x < 4 ? [100, 100, 100, 255] : [150, 150, 150, 255]))
    const sharp = applyImageEditOp(source, { kind: "sharpen", amount: 50 }, options)
    expect(pixelAt(sharp, 3, 2)).toEqual([75, 75, 75, 255])
    expect(pixelAt(sharp, 4, 2)).toEqual([175, 175, 175, 255])
    expect(pixelAt(applyImageEditOp(source, { kind: "sharpen", amount: 0 }, options), 3, 2)).toEqual([100, 100, 100, 255])
  })
})

describe("drawing operations", () => {
  const paper = () => paint(60, 60, () => WHITE)

  it("draws a freehand line, a dot for a single point, nothing without points", () => {
    const line = applyImageEditOp(paper(), {
      kind: "stroke",
      points: [{ x: 10, y: 30 }, { x: 30, y: 30 }, { x: 50, y: 30 }],
      color: "#ff0000",
      width: 6,
    }, options)
    expect(pixelAt(line, 30, 30)).toEqual(RED)
    expect(pixelAt(line, 30, 20)).toEqual(WHITE)
    // Round ends reach past the first point by half the width.
    expect(pixelAt(line, 8, 30)).toEqual(RED)
    const dot = applyImageEditOp(paper(), { kind: "stroke", points: [{ x: 30, y: 30 }], color: "#0000ff", width: 10 }, options)
    expect(pixelAt(dot, 30, 30)).toEqual(BLUE)
    expect(pixelAt(dot, 30, 40)).toEqual(WHITE)
    const two = applyImageEditOp(paper(), { kind: "stroke", points: [{ x: 10, y: 10 }, { x: 50, y: 50 }], color: "#00ff00", width: 4 }, options)
    expect(pixelAt(two, 30, 30)).toEqual(GREEN)
    expect(pixelAt(applyImageEditOp(paper(), { kind: "stroke", points: [], color: "#000", width: 4 }, options), 30, 30)).toEqual(WHITE)
    expect(pixelAt(applyImageEditOp(paper(), { kind: "stroke", points: [{ x: 30, y: 30 }], color: "#000", width: 0 }, options), 30, 30)).toEqual(WHITE)
  })

  it("draws a see-through line and does not leak the opacity into later drawing", () => {
    const faint = applyImageEditOp(paper(), {
      kind: "stroke",
      points: [{ x: 10, y: 30 }, { x: 50, y: 30 }],
      color: "#000000",
      width: 8,
      opacity: 0.5,
    }, options)
    expect(near(pixelAt(faint, 30, 30), [128, 128, 128, 255], 2)).toBe(true)
    const then = applyImageEditOp(faint, { kind: "stroke", points: [{ x: 30, y: 10 }], color: "#000000", width: 8 }, options)
    expect(pixelAt(then, 30, 10)).toEqual(BLACK)
  })

  it("draws lines, boxes and ellipses, outlined or filled", () => {
    const line = applyImageEditOp(paper(), { kind: "shape", shape: "line", from: { x: 10, y: 10 }, to: { x: 50, y: 10 }, color: "#ff0000", width: 4 }, options)
    expect(pixelAt(line, 30, 10)).toEqual(RED)
    const box = applyImageEditOp(paper(), { kind: "shape", shape: "rect", from: { x: 50, y: 50 }, to: { x: 10, y: 10 }, color: "#ff0000", width: 4 }, options)
    expect(pixelAt(box, 10, 30)).toEqual(RED)
    expect(pixelAt(box, 30, 50)).toEqual(RED)
    expect(pixelAt(box, 30, 30)).toEqual(WHITE)
    const filled = applyImageEditOp(paper(), { kind: "shape", shape: "rect", from: { x: 10, y: 10 }, to: { x: 50, y: 50 }, color: "#ff0000", width: 0, fill: "#0000ff" }, options)
    expect(pixelAt(filled, 30, 30)).toEqual(BLUE)
    expect(pixelAt(filled, 5, 5)).toEqual(WHITE)
    const ellipse = applyImageEditOp(paper(), { kind: "shape", shape: "ellipse", from: { x: 10, y: 20 }, to: { x: 50, y: 40 }, color: "#000000", width: 2, fill: "#00ff00" }, options)
    expect(pixelAt(ellipse, 30, 30)).toEqual(GREEN)
    expect(pixelAt(ellipse, 12, 21)).toEqual(WHITE)
    expect(pixelAt(applyImageEditOp(paper(), { kind: "shape", shape: "line", from: { x: 10, y: 10 }, to: { x: 50, y: 10 }, color: "#ff0000", width: 0 }, options), 30, 10)).toEqual(WHITE)
  })

  it("draws an arrow whose head is wider than its shaft and points at the end", () => {
    const arrow = applyImageEditOp(paper(), { kind: "shape", shape: "arrow", from: { x: 5, y: 30 }, to: { x: 55, y: 30 }, color: "#ff0000", width: 4 }, options)
    const head = arrowHeadLength(4)
    expect(head).toBe(16)
    expect(arrowHeadLength(1)).toBe(10)
    expect(pixelAt(arrow, 20, 30)).toEqual(RED)
    // Beside the shaft: empty. Beside the base of the head: filled.
    expect(pixelAt(arrow, 20, 35)).toEqual(WHITE)
    expect(near(pixelAt(arrow, 55 - head + 2, 35), RED, 8)).toBe(true)
    expect(pixelAt(arrow, 50, 30)).toEqual(RED)
    expect(pixelAt(arrow, 57, 30)).toEqual(WHITE)
    // No length: a dot, not a crash.
    const dot = applyImageEditOp(paper(), { kind: "shape", shape: "arrow", from: { x: 30, y: 30 }, to: { x: 30, y: 30 }, color: "#ff0000", width: 6 }, options)
    expect(pixelAt(dot, 30, 30)).toEqual(RED)
  })

  it("draws text, line by line, with an outline when asked", () => {
    const base: Extract<ImageEditOp, { kind: "text" }> = { kind: "text", text: "████", at: { x: 4, y: 4 }, size: 20, color: "#ff0000", font: "sans-serif" }
    const count = (canvas: EditCanvas, match: (pixel: number[]) => boolean) => {
      const data = getEditContext(canvas).getImageData(0, 0, canvas.width, canvas.height).data
      let total = 0
      for (let index = 0; index < data.length; index += 4) {
        if (match([data[index]!, data[index + 1]!, data[index + 2]!, data[index + 3]!])) {
          total += 1
        }
      }
      return total
    }
    const isRed = (pixel: number[]) => pixel[0]! > 200 && pixel[1]! < 60 && pixel[2]! < 60
    const isBlue = (pixel: number[]) => pixel[2]! > 200 && pixel[0]! < 60 && pixel[1]! < 60
    const single = applyImageEditOp(paint(120, 80, () => WHITE), base, options)
    const double = applyImageEditOp(paint(120, 80, () => WHITE), { ...base, text: "████\n████" }, options)
    expect(count(single, isRed)).toBeGreaterThan(100)
    expect(count(double, isRed)).toBeGreaterThan(count(single, isRed) * 1.6)
    const outlined = applyImageEditOp(paint(120, 80, () => WHITE), { ...base, outline: { color: "#0000ff", width: 3 } }, options)
    expect(count(outlined, isBlue)).toBeGreaterThan(50)
    expect(count(single, isBlue)).toBe(0)
    // Right-aligned text ends at the anchor instead of starting there.
    const right = applyImageEditOp(paint(120, 80, () => WHITE), { ...base, at: { x: 116, y: 4 }, align: "right" }, options)
    expect(count(right, isRed)).toBeGreaterThan(100)
    expect(pixelAt(applyImageEditOp(paint(20, 20, () => WHITE), { ...base, size: 0 }, options), 10, 10)).toEqual(WHITE)
  })

  it("measures text before drawing it", () => {
    const one = measureImageText({ kind: "text", text: "Hello", at: { x: 0, y: 0 }, size: 20, color: "#000" }, options)
    const two = measureImageText({ kind: "text", text: "Hello\nHello there", at: { x: 0, y: 0 }, size: 20, color: "#000", weight: 400, font: "serif" }, options)
    expect(one.height).toBe(25)
    expect(two.height).toBe(50)
    expect(one.width).toBeGreaterThan(20)
    expect(two.width).toBeGreaterThan(one.width)
  })
})

describe("renderImageEdit", () => {
  it("copies the source when there is nothing to do", () => {
    const source = quadrants(4, 4)
    const copy = renderImageEdit(source, [], options)
    expect(copy).not.toBe(source)
    expect(pixelAt(copy, 0, 0)).toEqual(RED)
  })

  it("replays the operations in order and ends at the predicted size", () => {
    const source = quadrants(40, 20)
    const ops: ImageEditOp[] = [
      { kind: "rotate", turns: 1 },
      { kind: "crop", rect: { x: 0, y: 0, width: 20, height: 20 } },
      { kind: "flip", axis: "horizontal" },
      { kind: "filter", name: "invert" },
      { kind: "resize", width: 10, height: 10 },
    ]
    const result = renderImageEdit(source, ops, options)
    expect(sizeOf(result)).toEqual(resolveEditedImageSize({ width: 40, height: 20 }, ops))
    // After the turn the top 20 rows are blue | red; mirrored: red | blue; inverted: cyan | yellow.
    expect(near(pixelAt(result, 2, 5), [0, 255, 255, 255])).toBe(true)
    expect(near(pixelAt(result, 7, 5), [255, 255, 0, 255])).toBe(true)
    expect(pixelAt(source, 0, 0)).toEqual(RED)
  })
})
