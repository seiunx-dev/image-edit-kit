import { describe, expect, it } from "bun:test"
import {
  DEFAULT_EXPORT_QUALITY,
  IMAGE_EXPORT_FORMATS,
  canEncodeImageFormat,
  encodeImageCanvas,
  exportImageEdit,
  imageExportExtension,
  imageExportFormatOfMimeType,
  imageExportMimeType,
  isLossyExportFormat,
  listEncodableImageFormats,
  resolveConvertedFileName,
  resolveEditedFileName,
  resolveExportQuality,
  resolveImageFileName,
  saveBlob,
  type EditCanvas,
} from "../src/index"
import { options, paint, pixelAt } from "./canvas"

describe("formats", () => {
  it("knows each format's type and extension", () => {
    expect(IMAGE_EXPORT_FORMATS.map(imageExportMimeType)).toEqual(["image/png", "image/jpeg", "image/webp"])
    expect(IMAGE_EXPORT_FORMATS.map(imageExportExtension)).toEqual(["png", "jpg", "webp"])
    expect(IMAGE_EXPORT_FORMATS.map(isLossyExportFormat)).toEqual([false, true, true])
  })

  it("keeps a quality between 0 and 1 and falls back when there is none", () => {
    expect(resolveExportQuality(0.5)).toBe(0.5)
    expect(resolveExportQuality(7)).toBe(1)
    expect(resolveExportQuality(-1)).toBe(0)
    expect(resolveExportQuality(undefined)).toBe(DEFAULT_EXPORT_QUALITY)
    expect(resolveExportQuality(Number.NaN)).toBe(DEFAULT_EXPORT_QUALITY)
  })

  it("reads a format back from a MIME type", () => {
    expect(imageExportFormatOfMimeType("image/png")).toBe("png")
    expect(imageExportFormatOfMimeType("IMAGE/JPEG; charset=binary")).toBe("jpeg")
    expect(imageExportFormatOfMimeType("image/jpg")).toBe("jpeg")
    expect(imageExportFormatOfMimeType("image/gif")).toBeNull()
    expect(imageExportFormatOfMimeType(null)).toBeNull()
  })
})

describe("file names", () => {
  it("names the edited copy with the saved format's extension", () => {
    expect(resolveEditedFileName("card_normal.webp")).toBe("card_normal-edited.png")
    expect(resolveEditedFileName("card_normal.png", "jpeg")).toBe("card_normal-edited.jpg")
    expect(resolveEditedFileName("noext", "webp")).toBe("noext-edited.webp")
    expect(resolveEditedFileName(".png")).toBe(".png-edited.png")
    expect(resolveEditedFileName("")).toBe("image-edited.png")
  })

  it("names a converted copy after the original with the new extension", () => {
    expect(resolveConvertedFileName("card_normal.webp", "jpeg")).toBe("card_normal.jpg")
    expect(resolveConvertedFileName("card.final.png", "webp")).toBe("card.final.webp")
    expect(resolveConvertedFileName("noext", "png")).toBe("noext.png")
    expect(resolveConvertedFileName("", "png")).toBe("image.png")
  })

  it("falls back for a URL without a file name", () => {
    expect(resolveImageFileName("https://example.com/a/b/%E5%8D%A1.png?x=1")).toBe("卡.png")
    expect(resolveImageFileName("https://example.com/folder/", "picture.png")).toBe("picture.png")
    expect(resolveImageFileName(undefined)).toBe("image.png")
    expect(resolveImageFileName("https://example.com/%E0%A4%A.png")).toBe("image.png")
  })
})

/** A canvas that records how it was asked to encode itself. */
function recordingCanvas(source: EditCanvas, mode: "toBlob" | "convertToBlob" | "fail") {
  const calls: { type?: string; quality?: number }[] = []
  const canvas = source as unknown as Record<string, unknown>
  if (mode === "convertToBlob") {
    canvas.toBlob = undefined
    canvas.convertToBlob = (settings: { type?: string; quality?: number }) => {
      calls.push(settings)
      return Promise.resolve(new Blob(["x"], { type: settings.type }))
    }
  } else {
    canvas.toBlob = (callback: (blob: Blob | null) => void, type?: string, quality?: number) => {
      calls.push({ type, quality })
      callback(mode === "fail" ? null : new Blob(["x"], { type }))
    }
  }
  return { canvas: source, calls }
}

describe("encodeImageCanvas", () => {
  it("writes PNG by default, without a quality", async () => {
    const { canvas, calls } = recordingCanvas(paint(2, 2, () => [1, 2, 3, 255]), "toBlob")
    const blob = await encodeImageCanvas(canvas)
    expect(blob.type).toBe("image/png")
    expect(calls).toEqual([{ type: "image/png", quality: undefined }])
  })

  it("passes the quality for lossy formats, within 0 to 1", async () => {
    const first = recordingCanvas(paint(2, 2, () => [1, 2, 3, 255]), "convertToBlob")
    await encodeImageCanvas(first.canvas, { format: "webp" })
    await encodeImageCanvas(first.canvas, { format: "webp", quality: 7 })
    await encodeImageCanvas(first.canvas, { format: "webp", quality: -1 })
    expect(first.calls).toEqual([
      { type: "image/webp", quality: DEFAULT_EXPORT_QUALITY },
      { type: "image/webp", quality: 1 },
      { type: "image/webp", quality: 0 },
    ])
  })

  it("puts a background behind a JPEG and leaves the caller's canvas alone", async () => {
    const source = paint(2, 2, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0]))
    const flattened: EditCanvas[] = []
    const blob = await encodeImageCanvas(source, {
      format: "jpeg",
      background: "#0000ff",
      createCanvas: (width, height) => {
        const { canvas } = recordingCanvas(options.createCanvas(width, height), "toBlob")
        flattened.push(canvas)
        return canvas
      },
    })
    expect(blob.type).toBe("image/jpeg")
    expect(flattened).toHaveLength(1)
    expect(pixelAt(flattened[0]!, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixelAt(flattened[0]!, 1, 0)).toEqual([0, 0, 255, 255])
    expect(pixelAt(source, 1, 0)).toEqual([0, 0, 0, 0])
    const white: EditCanvas[] = []
    await encodeImageCanvas(source, {
      format: "jpeg",
      createCanvas: (width, height) => {
        const { canvas } = recordingCanvas(options.createCanvas(width, height), "toBlob")
        white.push(canvas)
        return canvas
      },
    })
    expect(pixelAt(white[0]!, 1, 0)).toEqual([255, 255, 255, 255])
  })

  it("rejects when the canvas cannot be encoded", async () => {
    const { canvas } = recordingCanvas(paint(2, 2, () => [1, 2, 3, 255]), "fail")
    await expect(encodeImageCanvas(canvas)).rejects.toThrow("could not be encoded")
    const bare = { width: 1, height: 1 } as unknown as EditCanvas
    await expect(encodeImageCanvas(bare)).rejects.toThrow("cannot be encoded here")
  })

  it("really writes each format", async () => {
    const source = paint(8, 8, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 128]))
    const head = async (format: "png" | "jpeg" | "webp") => {
      const blob = await encodeImageCanvas(source, { ...options, format })
      expect(blob.type).toBe(imageExportMimeType(format))
      return Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 12))
    }
    expect((await head("png")).slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect((await head("jpeg")).slice(0, 2)).toEqual([0xff, 0xd8])
    const webp = await head("webp")
    expect(String.fromCharCode(...webp.slice(0, 4), ...webp.slice(8, 12))).toBe("RIFFWEBP")
  })
})

describe("format support", () => {
  it("always has PNG and finds the formats the canvas really writes", async () => {
    expect(await canEncodeImageFormat("png")).toBe(true)
    expect(await listEncodableImageFormats(options)).toEqual(["png", "jpeg", "webp"])
  })

  it("notices a canvas that answers with PNG instead", async () => {
    const pngOnly = {
      createCanvas: (width: number, height: number) => {
        const canvas = options.createCanvas(width, height) as unknown as Record<string, unknown>
        canvas.toBlob = (callback: (blob: Blob | null) => void) => callback(new Blob(["x"], { type: "image/png" }))
        return canvas as unknown as EditCanvas
      },
    }
    expect(await canEncodeImageFormat("webp", pngOnly)).toBe(false)
    expect(await listEncodableImageFormats(pngOnly)).toEqual(["png"])
  })

  it("answers no where there is no canvas, and remembers the answer", async () => {
    const first = canEncodeImageFormat("jpeg")
    expect(await first).toBe(false)
    expect(canEncodeImageFormat("jpeg")).toBe(first)
  })
})

describe("exportImageEdit", () => {
  it("converts a picture to another format without editing it", async () => {
    const source = paint(6, 4, () => [10, 200, 30, 255])
    const exported = await exportImageEdit(source, [], { ...options, format: "jpeg", quality: 0.8 })
    expect(exported.format).toBe("jpeg")
    expect(exported.blob.type).toBe("image/jpeg")
    expect({ width: exported.width, height: exported.height }).toEqual({ width: 6, height: 4 })
  })

  it("replays the edit first and reports the format the file really is", async () => {
    const source = paint(6, 4, () => [10, 200, 30, 255])
    const exported = await exportImageEdit(source, [{ kind: "rotate", turns: 1 }], options)
    expect(exported.format).toBe("png")
    expect({ width: exported.width, height: exported.height }).toEqual({ width: 4, height: 6 })
    const fallback = await exportImageEdit(source, [], {
      format: "webp",
      createCanvas: (width, height) => {
        const canvas = options.createCanvas(width, height) as unknown as Record<string, unknown>
        canvas.toBlob = (callback: (blob: Blob | null) => void) => callback(new Blob(["x"], { type: "image/png" }))
        return canvas as unknown as EditCanvas
      },
    })
    expect(fallback.format).toBe("png")
    const untyped = await exportImageEdit(source, [], {
      format: "webp",
      createCanvas: (width, height) => {
        const canvas = options.createCanvas(width, height) as unknown as Record<string, unknown>
        canvas.toBlob = (callback: (blob: Blob | null) => void) => callback(new Blob(["x"]))
        return canvas as unknown as EditCanvas
      },
    })
    expect(untyped.format).toBe("webp")
  })
})

describe("saveBlob", () => {
  it("clicks a download link and releases the object URL afterwards", async () => {
    const events: string[] = []
    const link = { href: "", download: "", click: () => events.push(`click ${link.download} ${link.href}`), remove: () => events.push("remove") }
    const globals = globalThis as { document?: unknown }
    const create = URL.createObjectURL
    const revoke = URL.revokeObjectURL
    const timer = globalThis.setTimeout
    globals.document = { createElement: () => link, body: { appendChild: () => events.push("append") } }
    URL.createObjectURL = () => "blob:test"
    URL.revokeObjectURL = (url: string) => { events.push(`revoke ${url}`) }
    globalThis.setTimeout = ((run: () => void) => { run(); return 0 }) as unknown as typeof setTimeout
    try {
      saveBlob(new Blob(["x"]), "picture-edited.png")
    } finally {
      delete globals.document
      URL.createObjectURL = create
      URL.revokeObjectURL = revoke
      globalThis.setTimeout = timer
    }
    expect(events).toEqual(["append", "click picture-edited.png blob:test", "remove", "revoke blob:test"])
  })
})
