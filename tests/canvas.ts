import { fileURLToPath } from "node:url"
import { GlobalFonts, createCanvas } from "@napi-rs/canvas"
import { getEditContext, type CanvasFactory, type EditCanvas } from "../src/index"

/** A real Canvas 2D implementation for the tests (there is no DOM under Bun). */
export const createTestCanvas: CanvasFactory = (width, height) => createCanvas(width, height) as unknown as EditCanvas

export const options = { createCanvas: createTestCanvas }

/**
 * A font the tests bring along: which fonts a machine has, and whether its
 * generic "sans-serif" has any glyphs at all, differs between systems.
 */
export const TEST_FONT = "Edit Kit Test Sans"
GlobalFonts.registerFromPath(
  fileURLToPath(new URL("../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf", import.meta.url)),
  TEST_FONT,
)

export type Rgba = [number, number, number, number]

/** A canvas painted pixel by pixel. */
export function paint(width: number, height: number, fill: (x: number, y: number) => Rgba): EditCanvas {
  const canvas = createTestCanvas(width, height)
  const context = getEditContext(canvas)
  const pixels = context.createImageData(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.data.set(fill(x, y), (y * width + x) * 4)
    }
  }
  context.putImageData(pixels, 0, 0)
  return canvas
}

export function pixelAt(canvas: EditCanvas, x: number, y: number): number[] {
  return Array.from(getEditContext(canvas).getImageData(x, y, 1, 1).data)
}

export function sizeOf(canvas: EditCanvas): { width: number; height: number } {
  return { width: canvas.width, height: canvas.height }
}

export const RED: Rgba = [255, 0, 0, 255]
export const GREEN: Rgba = [0, 255, 0, 255]
export const BLUE: Rgba = [0, 0, 255, 255]
export const WHITE: Rgba = [255, 255, 255, 255]
export const BLACK: Rgba = [0, 0, 0, 255]

/** Four quadrants: red top-left, green top-right, blue bottom-left, white bottom-right. */
export function quadrants(width: number, height: number): EditCanvas {
  return paint(width, height, (x, y) => (y < height / 2 ? (x < width / 2 ? RED : GREEN) : (x < width / 2 ? BLUE : WHITE)))
}
