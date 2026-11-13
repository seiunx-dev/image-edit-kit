# image-edit-kit

浏览器端的图片编辑库，TypeScript 编写，不依赖任何框架。[English](README.md)

一次编辑就是一串操作，按顺序在原图上重放：原图不会被改动，撤销只是去掉最后一个操作，同一串操作总是得到同一个结果。库本身没有界面、没有文案、没有依赖，只提供操作的定义、相关的几何计算、Canvas 2D 渲染和编码；界面由你自己用 Vue、React、Svelte 或原生 DOM 来写。

- **几何**：90° 旋转、镜像、裁剪、校正倾斜（裁掉空角或保留整图）、缩放尺寸。
- **色调与滤镜**：亮度、对比度、饱和度、色温、色相；黑白、怀旧、反色；模糊、锐化。
- **遮挡**：对选定区域打马赛克或模糊。
- **标注**：画笔、直线、箭头、矩形、椭圆、文字。
- **导出**：PNG、JPEG、WebP，可调质量；不做任何编辑也可以单纯转换格式（比如把 WebP 存成 JPEG），并能检测浏览器实际能写出哪些格式。
- **交互计算**：裁剪框的八个手柄和锁定比例、缩放与平移、屏幕坐标到图片坐标的换算、撤销与重做。

## 安装

没有发布到 npm。安装 [Release](https://github.com/seiunx-dev/image-edit-kit/releases) 里附带的包：

```bash
bun add https://github.com/seiunx-dev/image-edit-kit/releases/download/v0.1.0/image-edit-kit-0.1.0.tgz
# 或者：npm install <同一个地址>
```

包是带类型声明的 ESM，没有副作用，打包工具只会留下你用到的部分。

## 快速上手

```ts
import {
  exportImageEdit,
  loadImageSource,
  paintImageSource,
  renderImageEdit,
  resolveEditedFileName,
  resolveImageFileName,
  saveBlob,
  type ImageEditOp,
} from "image-edit-kit"

const loaded = await loadImageSource(["https://example.com/card.webp"])
if (!loaded) throw new Error("图片读取失败")

const ops: ImageEditOp[] = [
  { kind: "rotate", turns: 1 },
  { kind: "crop", rect: { x: 40, y: 40, width: 800, height: 600 } },
  { kind: "adjust", brightness: 10, contrast: 15 },
  { kind: "pixelate", size: 16, rect: { x: 20, y: 500, width: 240, height: 60 } },
]

// 显示
paintImageSource(document.querySelector("canvas")!, renderImageEdit(loaded.bitmap, ops))

// 存成 JPEG
const exported = await exportImageEdit(loaded.bitmap, ops, { format: "jpeg", quality: 0.9 })
saveBlob(exported.blob, resolveEditedFileName(resolveImageFileName(loaded.url), exported.format))
```

只转换格式时，操作列表留空即可：

```ts
const bitmap = await createImageBitmap(file) // 用户选的一张 WebP
const { blob } = await exportImageEdit(bitmap, [], { format: "jpeg" })
```

`bun run demo` 会启动一个只用原生 DOM 接入本库的演示页（`demo/`）。

## 操作

所有坐标都以“执行到这个操作时的图片”的像素为单位，也就是前面的操作生效之后的图片。

| `kind` | 字段 | 作用 |
|---|---|---|
| `rotate` | `turns: 1 \| -1` | 顺时针或逆时针旋转 90° |
| `flip` | `axis: "horizontal" \| "vertical"` | 左右或上下镜像 |
| `crop` | `rect` | 只保留矩形内的部分（超出图片的部分忽略） |
| `straighten` | `degrees`（-45 到 45），`fit?: "trim" \| "expand"` | 绕中心倾斜。`trim`（默认）保留同比例的最大正矩形，没有空角；`expand` 保留整张图，四角透明 |
| `resize` | `width`、`height` | 重采样；大幅缩小时逐级减半，避免锯齿 |
| `adjust` | `brightness?`、`contrast?`、`saturation?`、`temperature?`（-100 到 100），`hue?`（-180 到 180） | 色调与颜色，0 表示不变 |
| `filter` | `name: "grayscale" \| "sepia" \| "invert"`，`amount?`（0 到 1） | 预设滤镜 |
| `blur` | `radius`、`rect?` | 模糊指定区域，不给区域则模糊整张图 |
| `sharpen` | `amount`（0 到 100） | 锐化边缘 |
| `pixelate` | `size`、`rect?` | 给指定区域打马赛克，不给区域则是整张图 |
| `stroke` | `points`、`color`、`width`、`opacity?` | 画笔线条 |
| `shape` | `shape: "line" \| "arrow" \| "rect" \| "ellipse"`、`from`、`to`、`color`、`width`、`fill?` | 直线、指向 `to` 的箭头，或以两点为对角的矩形 / 椭圆 |
| `text` | `text`、`at`、`size`、`color`、`font?`、`weight?`、`italic?`、`align?`、`outline?`、`background?` | 文字，`\n` 换行；`outline` 是描边，`background` 是文字后面的衬底 |

操作都是普通 JSON。`parseImageEditOps(value)` 用来从存储或 URL 读回操作列表，只要有一项不合法就返回 `null`。

## API

### 模型

| 导出 | 用途 |
|---|---|
| `resolveEditedImageSize(size, ops)`、`applyImageOpSize(size, op)` | 不画图，直接算出操作之后的图片尺寸 |
| `isNoopImageEditOp(op, size)` | 操作不会带来任何变化时为 true（可用来禁用“应用”按钮） |
| `parseImageEditOp`、`parseImageEditOps` | 校验不可信的数据 |
| `fitImageSize(size, { maxWidth, maxHeight })`、`scaleImageSize(size, factor)` | 计算保持比例的 `resize` 尺寸 |
| `pushImageEdit`、`undoImageEdit`、`redoImageEdit`、`resetImageEdit`、`canUndoImageEdit`、`canRedoImageEdit`、`EMPTY_IMAGE_EDIT_HISTORY` | 撤销 / 重做，都是作用在 `{ ops, undone }` 上的纯函数；重置之后可以一步步重做回来 |

### 渲染

| 导出 | 用途 |
|---|---|
| `renderImageEdit(source, ops, options?)` | 在新画布上重放所有操作 |
| `applyImageEditOp(source, op, options?)` | 在新画布上执行一个操作。保留“已确认操作”的画布，再把草稿操作叠上去，就能实时预览 |
| `paintImageSource(target, source)` | 把结果画到页面上的 canvas |
| `measureImageText(op, options?)`、`measureImageTextBox(op, options?)` | 文字各行的宽高，以及文字在图片上占据的矩形（含对齐方式和衬底的内边距） |
| `createEditCanvas(width, height)` | 默认的画布工厂 |

`source` 可以是 `ImageBitmap`、`<img>`、canvas 或 `OffscreenCanvas`。画布由 `options.createCanvas` 提供：默认在页面里用 canvas 元素，在 worker 里用 `OffscreenCanvas`。在服务端，传入任何实现了标准 2D API 的库的工厂即可：

```ts
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { renderImageEdit } from "image-edit-kit"

const result = renderImageEdit(await loadImage("in.png") as never, ops, {
  createCanvas: (width, height) => createCanvas(width, height) as never,
})
```

### 像素

`adjustmentColorMatrix`、`filterColorMatrix`、`combineColorMatrices`、`applyColorMatrix`、`blurPixels`、`pixelatePixels`、`sharpenPixels` 直接处理 RGBA 字节（`{ data, width, height }`，与 `ImageData` 的布局相同），不需要画布。

### 导出

| 导出 | 用途 |
|---|---|
| `exportImageEdit(source, ops?, options?)` | 渲染加编码一步完成，返回 `{ blob, format, width, height }` |
| `encodeImageCanvas(canvas, { format, quality, background })` | 编码一张画布。JPEG 没有透明度，透明像素会显示 `background`（默认白色） |
| `canEncodeImageFormat(format)`、`listEncodableImageFormats()` | 当前浏览器实际能写出的格式。不支持 WebP 编码的浏览器会返回 PNG，`exportImageEdit` 返回的 `format` 是文件的真实格式 |
| `resolveImageFileName(url)`、`resolveEditedFileName(name, format)`、`resolveConvertedFileName(name, format)` | 编辑后 `card.webp` → `card-edited.jpg`，只转格式则是 `card.jpg` |
| `saveBlob(blob, name)` | 让浏览器下载文件 |
| `loadImageSource(candidates, options?)` | 下载并解码第一个可用的地址，返回 `{ bitmap, blob, url }` 或 `null` |

### 交互

| 导出 | 用途 |
|---|---|
| `initialCropRect`、`adjustCropRect`、`adjustCropRectWithAspect`、`fitCropRectToAspect`、`clampCropRect`、`CROP_HANDLES`、`CROP_ASPECTS` | 裁剪框：初始位置，拖动八个手柄之一或整个框时如何变化，自由比例或锁定比例 |
| `zoomImageView`、`clampImagePan`、`clampImageZoom`、`IMAGE_VIEW_FIT` | 以某一点为中心缩放、平移，图片边缘不会离开舞台边缘 |
| `screenToImagePoint(point, frame, size)` | 把指针位置换算成图片上的点 |
| `rectFromPoints(from, to, size)` | 一次拖动的起点和终点之间的区域 |
| `simplifyPoints(points, tolerance)` | 精简画笔拖动产生的采样点 |
| `resolveStraightenSize(size, degrees, fit)` | 倾斜之后的图片尺寸 |

## 开发

```bash
bun install
bun run quality   # lint、类型检查、测试
bun run build     # dist/index.js 和类型声明
bun run demo
```

测试在真实的 Canvas 2D 实现（`@napi-rs/canvas`）上运行渲染部分。

## 许可

[MIT](LICENSE)
