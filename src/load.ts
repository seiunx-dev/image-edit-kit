/** Reading a picture into something an edit can be replayed from. */

export type LoadedImage = {
  /** The decoded picture. Call `bitmap.close()` when done with it. */
  bitmap: ImageBitmap
  /** The file as it was downloaded, for saving the original untouched. */
  blob: Blob
  /** The candidate that worked. */
  url: string
}

export type LoadImageOptions = {
  /** Defaults to the global `fetch`. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** Defaults to `createImageBitmap`. */
  decode?: (blob: Blob) => Promise<ImageBitmap>
  /** Stops trying further candidates once aborted, and is passed on to `fetch`. */
  signal?: AbortSignal
  /** Extra request options (credentials, headers…). */
  init?: RequestInit
}

/**
 * Downloads and decodes the first candidate URL that works; empty entries
 * are skipped. Resolves to `null` when none does (a host that does not allow
 * cross-origin reads, a missing file, bytes that are not a picture) or when
 * the signal aborts.
 */
export async function loadImageSource(
  candidates: readonly (string | null | undefined)[],
  options: LoadImageOptions = {},
): Promise<LoadedImage | null> {
  const request = options.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init))
  const decode = options.decode ?? ((blob: Blob) => createImageBitmap(blob))
  for (const url of candidates) {
    if (!url) {
      continue
    }
    if (options.signal?.aborted) {
      return null
    }
    try {
      const response = await request(url, { ...options.init, signal: options.signal })
      if (!response.ok) {
        continue
      }
      const blob = await response.blob()
      const bitmap = await decode(blob)
      if (options.signal?.aborted) {
        bitmap.close()
        return null
      }
      return { bitmap, blob, url }
    } catch {
      // Network or decode failure: try the next candidate.
    }
  }
  return null
}
