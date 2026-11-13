import { describe, expect, it } from "bun:test"
import { loadImageSource } from "../src/index"

function bitmap() {
  const state = { closed: false }
  return { state, value: { width: 2, height: 2, close: () => { state.closed = true } } as unknown as ImageBitmap }
}

function response(ok: boolean, body = "bytes"): Response {
  return { ok, blob: () => Promise.resolve(new Blob([body])) } as unknown as Response
}

describe("loadImageSource", () => {
  it("returns the first candidate that downloads and decodes, skipping empty entries", async () => {
    const asked: string[] = []
    const picture = bitmap()
    const loaded = await loadImageSource([null, "", "a.png", "b.png", "c.png", "d.png"], {
      fetch: (url) => {
        asked.push(url)
        if (url === "a.png") return Promise.reject(new Error("offline"))
        return Promise.resolve(response(url !== "b.png", url))
      },
      decode: async (blob) => {
        if ((await blob.text()) === "c.png") throw new Error("not a picture")
        return picture.value
      },
    })
    expect(asked).toEqual(["a.png", "b.png", "c.png", "d.png"])
    expect(loaded?.url).toBe("d.png")
    expect(loaded?.bitmap).toBe(picture.value)
    expect(await loaded?.blob.text()).toBe("d.png")
  })

  it("resolves to null when nothing works", async () => {
    expect(await loadImageSource([], {})).toBeNull()
    expect(await loadImageSource(["a.png"], { fetch: () => Promise.resolve(response(false)) })).toBeNull()
  })

  it("passes the request options and the signal on", async () => {
    const controller = new AbortController()
    let seen: RequestInit | undefined
    await loadImageSource(["a.png"], {
      fetch: (_url, init) => {
        seen = init
        return Promise.resolve(response(false))
      },
      init: { credentials: "include" },
      signal: controller.signal,
    })
    expect(seen?.credentials).toBe("include")
    expect(seen?.signal).toBe(controller.signal)
  })

  it("stops once aborted and closes a picture decoded too late", async () => {
    const controller = new AbortController()
    controller.abort()
    let asked = 0
    expect(await loadImageSource(["a.png"], { signal: controller.signal, fetch: () => { asked += 1; return Promise.resolve(response(true)) } })).toBeNull()
    expect(asked).toBe(0)

    const late = new AbortController()
    const picture = bitmap()
    const loaded = await loadImageSource(["a.png"], {
      signal: late.signal,
      fetch: () => Promise.resolve(response(true)),
      decode: () => {
        late.abort()
        return Promise.resolve(picture.value)
      },
    })
    expect(loaded).toBeNull()
    expect(picture.state.closed).toBe(true)
  })

  it("uses the global fetch and createImageBitmap by default", async () => {
    const globals = globalThis as { fetch: unknown; createImageBitmap?: unknown }
    const originalFetch = globals.fetch
    const picture = bitmap()
    globals.fetch = () => Promise.resolve(response(true))
    globals.createImageBitmap = () => Promise.resolve(picture.value)
    try {
      expect((await loadImageSource(["a.png"]))?.bitmap).toBe(picture.value)
    } finally {
      globals.fetch = originalFetch
      delete globals.createImageBitmap
    }
  })
})
