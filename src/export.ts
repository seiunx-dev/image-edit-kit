/** Turning a rendered edit into a file: the format, the bytes, the name. */

import type { ImageEditOp } from "./ops"
import {
  copyImageSource,
  createEditCanvas,
  getEditContext,
  renderImageEdit,
  type EditCanvas,
  type ImageSource,
  type RenderOptions,
} from "./render"

export const IMAGE_EXPORT_FORMATS = ["png", "jpeg", "webp"] as const
export type ImageExportFormat = (typeof IMAGE_EXPORT_FORMATS)[number]

const MIME_TYPES: Record<ImageExportFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }
const EXTENSIONS: Record<ImageExportFormat, string> = { png: "png", jpeg: "jpg", webp: "webp" }

/** The quality used for JPEG and WebP when none is given. */
export const DEFAULT_EXPORT_QUALITY = 0.92

export function imageExportMimeType(format: ImageExportFormat): string {
  return MIME_TYPES[format]
}

export function imageExportExtension(format: ImageExportFormat): string {
  return EXTENSIONS[format]
}

/** True for the formats that take a quality (PNG is always lossless). */
export function isLossyExportFormat(format: ImageExportFormat): boolean {
  return format !== "png"
}

/** The format a MIME type names ("image/jpeg" → "jpeg"), or `null`. */
export function imageExportFormatOfMimeType(type: string | null | undefined): ImageExportFormat | null {
  const normalized = (type ?? "").split(";")[0]!.trim().toLowerCase()
  return IMAGE_EXPORT_FORMATS.find((format) => MIME_TYPES[format] === normalized) ?? (normalized === "image/jpg" ? "jpeg" : null)
}

export type EncodeOptions = RenderOptions & {
  /** Defaults to `png`. */
  format?: ImageExportFormat
  /** 0 to 1, for JPEG and WebP. Defaults to `DEFAULT_EXPORT_QUALITY`. */
  quality?: number
  /** What shows through transparent pixels in a JPEG, which has no transparency. Defaults to white. */
  background?: string
}

/**
 * The canvas as an image file. A browser that cannot write the format asked
 * for answers with a PNG: check the blob's `type` (see
 * `imageExportFormatOfMimeType`) before naming the file.
 */
export function encodeImageCanvas(canvas: EditCanvas, options: EncodeOptions = {}): Promise<Blob> {
  const format = options.format ?? "png"
  const type = MIME_TYPES[format]
  const quality = isLossyExportFormat(format)
    ? Math.min(1, Math.max(0, Number.isFinite(options.quality) ? (options.quality as number) : DEFAULT_EXPORT_QUALITY))
    : undefined

  let output = canvas
  if (format === "jpeg") {
    // Drawn over the background on a canvas of its own: the caller's canvas stays as it is.
    output = copyImageSource(canvas, options)
    const context = getEditContext(output)
    context.globalCompositeOperation = "destination-over"
    context.fillStyle = options.background ?? "#ffffff"
    context.fillRect(0, 0, output.width, output.height)
  }

  return canvasToBlob(output, type, quality)
}

function canvasToBlob(canvas: EditCanvas, type: string, quality: number | undefined): Promise<Blob> {
  const element = canvas as HTMLCanvasElement
  if (typeof element.toBlob === "function") {
    return new Promise((resolve, reject) => {
      element.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error("image-edit-kit: the canvas could not be encoded"))
        }
      }, type, quality)
    })
  }
  const offscreen = canvas as OffscreenCanvas
  if (typeof offscreen.convertToBlob === "function") {
    return offscreen.convertToBlob({ type, quality })
  }
  return Promise.reject(new Error("image-edit-kit: the canvas cannot be encoded here"))
}

const supported = new Map<ImageExportFormat, Promise<boolean>>()

/**
 * Whether this environment can really write `format`. Every browser writes
 * PNG and JPEG; one that cannot write WebP quietly hands back a PNG instead,
 * which is what this checks for. The answer for the default canvas is
 * remembered.
 */
export function canEncodeImageFormat(format: ImageExportFormat, options: RenderOptions = {}): Promise<boolean> {
  if (format === "png") {
    return Promise.resolve(true)
  }
  const remembered = options.createCanvas ? undefined : supported.get(format)
  if (remembered) {
    return remembered
  }
  const answer = (async () => {
    try {
      const canvas = (options.createCanvas ?? createEditCanvas)(1, 1)
      getEditContext(canvas)
      const blob = await canvasToBlob(canvas, MIME_TYPES[format], DEFAULT_EXPORT_QUALITY)
      return imageExportFormatOfMimeType(blob.type) === format
    } catch {
      return false
    }
  })()
  if (!options.createCanvas) {
    supported.set(format, answer)
  }
  return answer
}

/** The formats this environment can write, in the order of `IMAGE_EXPORT_FORMATS`. */
export async function listEncodableImageFormats(options: RenderOptions = {}): Promise<ImageExportFormat[]> {
  const answers = await Promise.all(IMAGE_EXPORT_FORMATS.map((format) => canEncodeImageFormat(format, options)))
  return IMAGE_EXPORT_FORMATS.filter((_, index) => answers[index])
}

export type ExportedImage = {
  blob: Blob
  /** The format the file really is: the one asked for, or PNG where the browser fell back to it. */
  format: ImageExportFormat
  width: number
  height: number
}

/**
 * Replays `ops` on `source` and encodes the result: the whole way from a
 * picture to a file. With no operations it converts the picture from one
 * format to another (a WebP saved as JPEG, a PNG as WebP…).
 */
export async function exportImageEdit(
  source: ImageSource,
  ops: readonly ImageEditOp[] = [],
  options: EncodeOptions = {},
): Promise<ExportedImage> {
  const canvas = renderImageEdit(source, ops, options)
  const blob = await encodeImageCanvas(canvas, options)
  return {
    blob,
    format: imageExportFormatOfMimeType(blob.type) ?? options.format ?? "png",
    width: canvas.width,
    height: canvas.height,
  }
}

/** The file name at the end of a URL ("card_normal.png"), or the fallback. */
export function resolveImageFileName(url: string | null | undefined, fallback = "image.png"): string {
  if (!url) {
    return fallback
  }
  try {
    const name = decodeURIComponent(new URL(url, "https://local.invalid").pathname.split("/").pop() ?? "")
    return name && name.includes(".") ? name : fallback
  } catch {
    return fallback
  }
}

/** "card_normal.webp" → "card_normal-edited.png": the original's name, marked as edited, with the saved format's extension. */
export function resolveEditedFileName(originalName: string, format: ImageExportFormat = "png"): string {
  const dot = originalName.lastIndexOf(".")
  const base = dot > 0 ? originalName.slice(0, dot) : originalName
  return `${base || "image"}-edited.${EXTENSIONS[format]}`
}

/** "card_normal.webp" → "card_normal.jpg": the same name with the saved format's extension, for a plain format conversion. */
export function resolveConvertedFileName(originalName: string, format: ImageExportFormat): string {
  const dot = originalName.lastIndexOf(".")
  const base = dot > 0 ? originalName.slice(0, dot) : originalName
  return `${base || "image"}.${EXTENSIONS[format]}`
}

/** Hands a blob to the browser as a download named `name`. Needs a page. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
