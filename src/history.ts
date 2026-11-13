import type { ImageEditOp } from "./ops"

/**
 * The operations applied so far and the ones undone since, newest last.
 * Every function returns a new history; none changes the one it is given.
 */
export type ImageEditHistory = {
  readonly ops: readonly ImageEditOp[]
  readonly undone: readonly ImageEditOp[]
}

export const EMPTY_IMAGE_EDIT_HISTORY: ImageEditHistory = { ops: [], undone: [] }

/** Adds an operation. Anything undone before it can no longer be redone. */
export function pushImageEdit(history: ImageEditHistory, op: ImageEditOp): ImageEditHistory {
  return { ops: [...history.ops, op], undone: [] }
}

export function canUndoImageEdit(history: ImageEditHistory): boolean {
  return history.ops.length > 0
}

export function canRedoImageEdit(history: ImageEditHistory): boolean {
  return history.undone.length > 0
}

/** Takes the newest operation back. */
export function undoImageEdit(history: ImageEditHistory): ImageEditHistory {
  const last = history.ops.at(-1)
  return last ? { ops: history.ops.slice(0, -1), undone: [...history.undone, last] } : history
}

/** Applies the operation undone last again. */
export function redoImageEdit(history: ImageEditHistory): ImageEditHistory {
  const last = history.undone.at(-1)
  return last ? { ops: [...history.ops, last], undone: history.undone.slice(0, -1) } : history
}

/**
 * Back to the original picture. The operations stay redoable, oldest first,
 * so a reset pressed by mistake can be walked back.
 */
export function resetImageEdit(history: ImageEditHistory): ImageEditHistory {
  return history.ops.length === 0 ? history : { ops: [], undone: [...history.undone, ...[...history.ops].reverse()] }
}
