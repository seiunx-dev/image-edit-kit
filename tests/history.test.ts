import { describe, expect, it } from "bun:test"
import {
  EMPTY_IMAGE_EDIT_HISTORY,
  canRedoImageEdit,
  canUndoImageEdit,
  pushImageEdit,
  redoImageEdit,
  resetImageEdit,
  undoImageEdit,
  type ImageEditOp,
} from "../src/index"

const turn: ImageEditOp = { kind: "rotate", turns: 1 }
const flip: ImageEditOp = { kind: "flip", axis: "horizontal" }
const crop: ImageEditOp = { kind: "crop", rect: { x: 0, y: 0, width: 10, height: 10 } }

describe("edit history", () => {
  it("starts with nothing to undo or redo", () => {
    expect(canUndoImageEdit(EMPTY_IMAGE_EDIT_HISTORY)).toBe(false)
    expect(canRedoImageEdit(EMPTY_IMAGE_EDIT_HISTORY)).toBe(false)
    expect(undoImageEdit(EMPTY_IMAGE_EDIT_HISTORY)).toBe(EMPTY_IMAGE_EDIT_HISTORY)
    expect(redoImageEdit(EMPTY_IMAGE_EDIT_HISTORY)).toBe(EMPTY_IMAGE_EDIT_HISTORY)
    expect(resetImageEdit(EMPTY_IMAGE_EDIT_HISTORY)).toBe(EMPTY_IMAGE_EDIT_HISTORY)
  })

  it("undoes and redoes in order without changing the history it was given", () => {
    const two = pushImageEdit(pushImageEdit(EMPTY_IMAGE_EDIT_HISTORY, turn), flip)
    const one = undoImageEdit(two)
    expect(two.ops).toEqual([turn, flip])
    expect(one).toEqual({ ops: [turn], undone: [flip] })
    expect(canRedoImageEdit(one)).toBe(true)
    expect(redoImageEdit(one)).toEqual({ ops: [turn, flip], undone: [] })
    expect(undoImageEdit(one)).toEqual({ ops: [], undone: [flip, turn] })
  })

  it("forgets what was undone once something new is applied", () => {
    const undone = undoImageEdit(pushImageEdit(EMPTY_IMAGE_EDIT_HISTORY, turn))
    expect(pushImageEdit(undone, crop)).toEqual({ ops: [crop], undone: [] })
  })

  it("resets to the original and lets the operations be redone in their order", () => {
    let history = pushImageEdit(pushImageEdit(pushImageEdit(EMPTY_IMAGE_EDIT_HISTORY, turn), flip), crop)
    history = resetImageEdit(history)
    expect(history.ops).toEqual([])
    history = redoImageEdit(history)
    expect(history.ops).toEqual([turn])
    history = redoImageEdit(redoImageEdit(history))
    expect(history).toEqual({ ops: [turn, flip, crop], undone: [] })
  })
})
