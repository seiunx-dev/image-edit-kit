import { describe, expect, it } from "bun:test"
import {
  IMAGE_EDIT_OP_KINDS,
  MAX_BLUR_RADIUS,
  MAX_IMAGE_DIMENSION,
  applyImageOpSize,
  fitImageSize,
  isNeutralAdjustment,
  isNoopImageEditOp,
  parseImageEditOp,
  parseImageEditOps,
  resolveCropRect,
  resolveEditedImageSize,
  resolveResizeSize,
  resolveStraightenSize,
  scaleImageSize,
  type ImageEditOp,
} from "../src/index"

const size = { width: 400, height: 200 }

describe("sizes", () => {
  it("follows every operation that changes the picture's size", () => {
    const ops: ImageEditOp[] = [
      { kind: "rotate", turns: 1 },
      { kind: "adjust", brightness: 20 },
      { kind: "crop", rect: { x: 0, y: 0, width: 100, height: 300 } },
      { kind: "resize", width: 50, height: 150 },
      { kind: "straighten", degrees: 5 },
      { kind: "pixelate", size: 8 },
    ]
    expect(resolveEditedImageSize(size, ops.slice(0, 3))).toEqual({ width: 100, height: 300 })
    expect(resolveEditedImageSize(size, ops.slice(0, 4))).toEqual({ width: 50, height: 150 })
    expect(resolveEditedImageSize(size, ops)).toEqual(resolveStraightenSize({ width: 50, height: 150 }, 5))
  })

  it("keeps only the part of a crop that is inside the picture", () => {
    expect(applyImageOpSize(size, { kind: "crop", rect: { x: 350, y: 150, width: 200, height: 200 } })).toEqual({ width: 50, height: 50 })
    expect(applyImageOpSize(size, { kind: "crop", rect: { x: 900, y: 0, width: 10, height: 10 } })).toEqual(size)
    expect(resolveCropRect({ x: -5, y: -5, width: 900, height: 900 }, size)).toBeNull()
  })

  it("keeps the size for an untilted straighten and takes the expanded box when asked", () => {
    expect(applyImageOpSize(size, { kind: "straighten", degrees: 0 })).toEqual(size)
    expect(applyImageOpSize(size, { kind: "straighten", degrees: 45, fit: "expand" })).toEqual(resolveStraightenSize(size, 45, "expand"))
  })

  it("resizes to whole pixels within the limits", () => {
    expect(resolveResizeSize({ width: 10.6, height: 0.2 })).toEqual({ width: 11, height: 1 })
    expect(resolveResizeSize({ width: 1e9, height: Number.NaN })).toEqual({ width: MAX_IMAGE_DIMENSION, height: 1 })
  })

  it("fits inside bounds without enlarging, and scales by a factor", () => {
    expect(fitImageSize(size, { maxWidth: 100 })).toEqual({ width: 100, height: 50 })
    expect(fitImageSize(size, { maxWidth: 300, maxHeight: 50 })).toEqual({ width: 100, height: 50 })
    expect(fitImageSize(size, { maxWidth: 4000, maxHeight: 0 })).toEqual(size)
    expect(scaleImageSize(size, 0.5)).toEqual({ width: 200, height: 100 })
  })
})

describe("operations that change nothing", () => {
  it("names every kind", () => {
    const kinds: ImageEditOp["kind"][] = [...IMAGE_EDIT_OP_KINDS]
    expect(new Set(kinds).size).toBe(13)
  })

  it("recognises them", () => {
    const noops: ImageEditOp[] = [
      { kind: "crop", rect: { x: 0, y: 0, width: 400, height: 200 } },
      { kind: "straighten", degrees: 0 },
      { kind: "resize", width: 400, height: 200 },
      { kind: "adjust" },
      { kind: "adjust", brightness: 0, hue: 0 },
      { kind: "filter", name: "sepia", amount: 0 },
      { kind: "blur", radius: 0 },
      { kind: "blur", radius: 4, rect: { x: 500, y: 0, width: 10, height: 10 } },
      { kind: "sharpen", amount: 0 },
      { kind: "pixelate", size: 1 },
      { kind: "pixelate", size: 8, rect: { x: 0, y: 300, width: 10, height: 10 } },
      { kind: "stroke", points: [], color: "#f00", width: 4 },
      { kind: "stroke", points: [{ x: 1, y: 1 }], color: "#f00", width: 4, opacity: 0 },
      { kind: "shape", shape: "rect", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: "#f00", width: 0 },
      { kind: "text", text: "  ", at: { x: 0, y: 0 }, size: 20, color: "#fff" },
    ]
    for (const op of noops) {
      expect(isNoopImageEditOp(op, size)).toBe(true)
    }
  })

  it("lets everything else through", () => {
    const real: ImageEditOp[] = [
      { kind: "rotate", turns: 1 },
      { kind: "flip", axis: "vertical" },
      { kind: "crop", rect: { x: 0, y: 0, width: 399, height: 200 } },
      { kind: "straighten", degrees: -3 },
      { kind: "resize", width: 200, height: 100 },
      { kind: "adjust", contrast: -10 },
      { kind: "filter", name: "grayscale" },
      { kind: "blur", radius: 3, rect: { x: 10, y: 10, width: 50, height: 50 } },
      { kind: "sharpen", amount: 30 },
      { kind: "pixelate", size: 12 },
      { kind: "stroke", points: [{ x: 1, y: 1 }], color: "#f00", width: 4 },
      { kind: "shape", shape: "rect", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: "#f00", width: 0, fill: "#00f" },
      { kind: "text", text: "hi", at: { x: 0, y: 0 }, size: 20, color: "#fff" },
    ]
    for (const op of real) {
      expect(isNoopImageEditOp(op, size)).toBe(false)
    }
    expect(isNeutralAdjustment({ saturation: 1 })).toBe(false)
  })
})

describe("parsing", () => {
  it("round-trips a full list through JSON", () => {
    const ops: ImageEditOp[] = [
      { kind: "rotate", turns: -1 },
      { kind: "flip", axis: "horizontal" },
      { kind: "crop", rect: { x: 1, y: 2, width: 30, height: 40 } },
      { kind: "straighten", degrees: 12, fit: "expand" },
      { kind: "resize", width: 640, height: 360 },
      { kind: "adjust", brightness: 10, contrast: -20, saturation: 30, temperature: -40, hue: 90 },
      { kind: "filter", name: "sepia", amount: 0.5 },
      { kind: "blur", radius: 6, rect: { x: 0, y: 0, width: 10, height: 10 } },
      { kind: "sharpen", amount: 40 },
      { kind: "pixelate", size: 16 },
      { kind: "stroke", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: "#ff0000", width: 6, opacity: 0.5 },
      { kind: "shape", shape: "arrow", from: { x: 0, y: 0 }, to: { x: 50, y: 50 }, color: "red", width: 4, fill: "blue" },
      { kind: "text", text: "a\nb", at: { x: 5, y: 6 }, size: 24, color: "#fff", font: "serif", weight: 700, italic: true, align: "center", outline: { color: "#000", width: 2 }, background: { color: "#0008", padding: 4, radius: 6 } },
      { kind: "text", text: "plain plate", at: { x: 0, y: 0 }, size: 12, color: "#000", background: { color: "#fff" } },
    ]
    expect(parseImageEditOps(JSON.parse(JSON.stringify(ops)))).toEqual(ops)
  })

  it("keeps values within their ranges", () => {
    expect(parseImageEditOp({ kind: "straighten", degrees: 80 })).toEqual({ kind: "straighten", degrees: 45 })
    expect(parseImageEditOp({ kind: "adjust", brightness: 500, hue: -900 })).toEqual({ kind: "adjust", brightness: 100, hue: -180 })
    expect(parseImageEditOp({ kind: "filter", name: "invert", amount: 7 })).toEqual({ kind: "filter", name: "invert", amount: 1 })
    expect(parseImageEditOp({ kind: "blur", radius: 1e6 })).toEqual({ kind: "blur", radius: MAX_BLUR_RADIUS })
    expect(parseImageEditOp({ kind: "sharpen", amount: 900 })).toEqual({ kind: "sharpen", amount: 100 })
    expect(parseImageEditOp({ kind: "pixelate", size: 7.6 })).toEqual({ kind: "pixelate", size: 8 })
    expect(parseImageEditOp({ kind: "resize", width: 1e9, height: 2.4 })).toEqual({ kind: "resize", width: MAX_IMAGE_DIMENSION, height: 2 })
    expect(parseImageEditOp({ kind: "stroke", points: [], color: "#000", width: 2, opacity: 4 })).toEqual({ kind: "stroke", points: [], color: "#000", width: 2, opacity: 1 })
    expect(parseImageEditOp({ kind: "text", text: "x", at: { x: 0, y: 0 }, size: 10, color: "#000", weight: "bold" })).toEqual({ kind: "text", text: "x", at: { x: 0, y: 0 }, size: 10, color: "#000", weight: "bold" })
  })

  it("rejects anything that is not an operation", () => {
    const invalid: unknown[] = [
      null,
      "rotate",
      [],
      { kind: "spin" },
      { kind: "rotate", turns: 2 },
      { kind: "flip", axis: "diagonal" },
      { kind: "crop" },
      { kind: "crop", rect: { x: 0, y: 0, width: 0, height: 10 } },
      { kind: "crop", rect: { x: "0", y: 0, width: 5, height: 10 } },
      { kind: "straighten", degrees: "3" },
      { kind: "straighten", degrees: 3, fit: "stretch" },
      { kind: "resize", width: 0, height: 10 },
      { kind: "adjust", brightness: "high" },
      { kind: "filter", name: "vivid" },
      { kind: "filter", name: "sepia", amount: "1" },
      { kind: "blur", radius: -1 },
      { kind: "blur", radius: 2, rect: { x: 0 } },
      { kind: "sharpen", amount: -1 },
      { kind: "pixelate", size: 1 },
      { kind: "pixelate", size: 4, rect: "all" },
      { kind: "stroke", points: "none", color: "#000", width: 2 },
      { kind: "stroke", points: [{ x: 1 }], color: "#000", width: 2 },
      { kind: "stroke", points: [], color: "", width: 2 },
      { kind: "stroke", points: [], color: "#000", width: 0 },
      { kind: "stroke", points: [], color: "#000", width: 2, opacity: "half" },
      { kind: "shape", shape: "star", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: "#000", width: 1 },
      { kind: "shape", shape: "rect", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: "#000", width: 1, fill: 7 },
      { kind: "shape", shape: "rect", from: null, to: { x: 1, y: 1 }, color: "#000", width: 1 },
      { kind: "text", text: 5, at: { x: 0, y: 0 }, size: 10, color: "#000" },
      { kind: "text", text: "x", at: { x: 0, y: 0 }, size: 0, color: "#000" },
      { kind: "text", text: "x", at: { x: 0, y: 0 }, size: 10, color: "#000", font: 3 },
      { kind: "text", text: "x", at: { x: 0, y: 0 }, size: 10, color: "#000", weight: {} },
      { kind: "text", text: "x", at: { x: 0, y: 0 }, size: 10, color: "#000", align: "justify" },
      { kind: "text", text: "x", at: { x: 0, y: 0 }, size: 10, color: "#000", outline: { color: "#000" } },
      { kind: "text", text: "x", at: { x: 0, y: 0 }, size: 10, color: "#000", italic: "yes" },
      { kind: "text", text: "x", at: { x: 0, y: 0 }, size: 10, color: "#000", background: "#fff" },
      { kind: "text", text: "x", at: { x: 0, y: 0 }, size: 10, color: "#000", background: { color: "" } },
      { kind: "text", text: "x", at: { x: 0, y: 0 }, size: 10, color: "#000", background: { color: "#fff", padding: -1 } },
      { kind: "text", text: "x", at: { x: 0, y: 0 }, size: 10, color: "#000", background: { color: "#fff", radius: "2" } },
    ]
    for (const value of invalid) {
      expect(parseImageEditOp(value)).toBeNull()
    }
  })

  it("takes a list whole or not at all", () => {
    expect(parseImageEditOps("[]")).toBeNull()
    expect(parseImageEditOps([])).toEqual([])
    expect(parseImageEditOps([{ kind: "rotate", turns: 1 }, { kind: "rotate", turns: 3 }])).toBeNull()
  })
})
