// A page with no framework: the library's functions wired straight to the DOM.
import {
  EMPTY_IMAGE_EDIT_HISTORY,
  exportImageEdit,
  listEncodableImageFormats,
  paintImageSource,
  parseImageEditOp,
  pushImageEdit,
  rectFromPoints,
  redoImageEdit,
  renderImageEdit,
  resetImageEdit,
  resolveEditedFileName,
  saveBlob,
  screenToImagePoint,
  simplifyPoints,
  undoImageEdit,
  type ImageEditHistory,
  type ImageEditOp,
  type ImageExportFormat,
  type ImagePoint,
  type ImageSource,
} from "../src/index"

const byId = <Element extends HTMLElement>(id: string) => document.getElementById(id) as Element
const view = byId<HTMLCanvasElement>("view")
const info = byId("info")
const formatSelect = byId<HTMLSelectElement>("format")
const dragSelect = byId<HTMLSelectElement>("drag")
const colorInput = byId<HTMLInputElement>("color")
const qualityInput = byId<HTMLInputElement>("quality")

let source: ImageSource = sample()
let name = "sample.png"
let history: ImageEditHistory = EMPTY_IMAGE_EDIT_HISTORY

/** Something to edit before a file is chosen. */
function sample(): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = 640
  canvas.height = 360
  const context = canvas.getContext("2d")!
  const sky = context.createLinearGradient(0, 0, 640, 360)
  sky.addColorStop(0, "#33ccbb")
  sky.addColorStop(1, "#ff6699")
  context.fillStyle = sky
  context.fillRect(0, 0, 640, 360)
  context.fillStyle = "#ffffff"
  context.font = "600 48px system-ui, sans-serif"
  context.fillText("image-edit-kit", 40, 190)
  for (let index = 0; index < 12; index += 1) {
    context.fillStyle = `hsl(${index * 30} 90% 55%)`
    context.fillRect(40 + index * 46, 240, 40, 40)
  }
  return canvas
}

function render(draft?: ImageEditOp): void {
  const edited = renderImageEdit(source, draft ? [...history.ops, draft] : history.ops)
  paintImageSource(view, edited)
  info.textContent = `${edited.width} × ${edited.height} · ${history.ops.length} operation(s)`
  byId<HTMLButtonElement>("undo").disabled = history.ops.length === 0
  byId<HTMLButtonElement>("redo").disabled = history.undone.length === 0
  byId<HTMLButtonElement>("reset").disabled = history.ops.length === 0
}

function apply(op: ImageEditOp): void {
  history = pushImageEdit(history, op)
  render()
}

byId("tools").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-op]")
  const op = button ? parseImageEditOp(JSON.parse(button.dataset.op!)) : null
  if (op) {
    apply(op)
  }
})

byId("undo").addEventListener("click", () => { history = undoImageEdit(history); render() })
byId("redo").addEventListener("click", () => { history = redoImageEdit(history); render() })
byId("reset").addEventListener("click", () => { history = resetImageEdit(history); render() })

byId<HTMLInputElement>("file").addEventListener("change", async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) {
    return
  }
  source = await createImageBitmap(file)
  name = file.name
  history = EMPTY_IMAGE_EDIT_HISTORY
  render()
})

byId("save").addEventListener("click", async () => {
  const exported = await exportImageEdit(source, history.ops, {
    format: formatSelect.value as ImageExportFormat,
    quality: Number(qualityInput.value),
  })
  saveBlob(exported.blob, resolveEditedFileName(name, exported.format))
})

// Dragging on the picture: a line, a shape or a region, previewed as a draft operation.
let points: ImagePoint[] = []

function toImage(event: PointerEvent): ImagePoint {
  return screenToImagePoint({ x: event.clientX, y: event.clientY }, view.getBoundingClientRect(), view)
}

function draftOp(): ImageEditOp | null {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) {
    return null
  }
  const width = Math.max(2, Math.round(view.width / 160))
  const rect = rectFromPoints(first, last, view)
  switch (dragSelect.value) {
    case "stroke":
      return { kind: "stroke", points: simplifyPoints(points, 0.75), color: colorInput.value, width: width * 2 }
    case "arrow":
      return { kind: "shape", shape: "arrow", from: first, to: last, color: colorInput.value, width: width * 2 }
    case "rect":
      return { kind: "shape", shape: "rect", from: first, to: last, color: colorInput.value, width }
    case "pixelate":
      return rect.width > 0 && rect.height > 0 ? { kind: "pixelate", size: Math.max(4, width * 4), rect } : null
    case "blur":
      return rect.width > 0 && rect.height > 0 ? { kind: "blur", radius: width * 4, rect } : null
    default:
      return rect.width > 0 && rect.height > 0 ? { kind: "shape", shape: "rect", from: first, to: last, color: "#ffffff", width: 1 } : null
  }
}

view.addEventListener("pointerdown", (event) => {
  view.setPointerCapture(event.pointerId)
  points = [toImage(event)]
})

view.addEventListener("pointermove", (event) => {
  if (points.length === 0) {
    return
  }
  points.push(toImage(event))
  render(draftOp() ?? undefined)
})

view.addEventListener("pointerup", () => {
  const first = points[0]
  const last = points[points.length - 1]
  const op = dragSelect.value === "crop" && first && last
    ? { kind: "crop" as const, rect: rectFromPoints(first, last, view) }
    : draftOp()
  points = []
  if (op && !(op.kind === "crop" && (op.rect.width < 2 || op.rect.height < 2))) {
    apply(op)
  } else {
    render()
  }
})

void listEncodableImageFormats().then((formats) => {
  formatSelect.replaceChildren(...formats.map((format) => new Option(format.toUpperCase(), format)))
})

render()
