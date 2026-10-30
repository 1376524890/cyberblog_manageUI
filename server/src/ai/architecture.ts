import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { settingsPath } from "./settings.ts";
import { ApiError } from "../core/errors.ts";

export interface Architecture {
  diagramTitle: string;
  nodes: {
    label: string;
    path: string;
    description: string;
    layer: "entry" | "core" | "support";
  }[];
  edges: { from: number; to: number; label: string; evidence: string }[];
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const colors = {
  entry: ["#eef0ff", "#7569d5", "入口与交互"],
  core: ["#e7f7f3", "#25877c", "核心模块"],
  support: ["#fff4e6", "#b47c35", "数据与支撑"],
};
let fontPromise: Promise<string> | null = null;
export async function diagramFont() {
  if (!fontPromise)
    fontPromise = (async () => {
      const file =
        process.env.CMS_DIAGRAM_FONT ??
        path.join(
          path.dirname(settingsPath),
          ".runtime/github-daily/fonts/NotoSansCJKsc-Regular.otf",
        );
      try {
        await fs.access(file);
        return file;
      } catch {}
      const response = await fetch(
        "https://api.github.com/repos/notofonts/noto-cjk/contents/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf?ref=main",
        {
          headers: {
            Accept: "application/vnd.github.raw+json",
            "User-Agent": "CyberBlog-Architecture",
          },
          signal: AbortSignal.timeout(90000),
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new ApiError(
          502,
          "DIAGRAM_FONT",
          "架构图中文字体下载失败，请稍后重试",
        );
      const buffer = Buffer.from(await response.arrayBuffer());
      if (
        buffer.length > 24_000_000 ||
        buffer.subarray(0, 4).toString() !== "OTTO"
      )
        throw new ApiError(502, "DIAGRAM_FONT", "架构图字体文件无效");
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.writeFile(file, buffer, { mode: 0o600 });
      return file;
    })().catch((e) => {
      fontPromise = null;
      throw e;
    });
  return fontPromise;
}
export async function renderArchitecturePNG(
  repo: string,
  a: Architecture,
): Promise<Buffer> {
  const font = await diagramFont();
  const width = 1800,
    cardW = 470,
    cardH = 188,
    gapX = 76,
    gapY = 156;
  const rows: { layer: keyof typeof colors; indexes: number[] }[] = [];
  for (const layer of ["entry", "core", "support"] as const) {
    const indexes = a.nodes
      .map((n, i) => (n.layer === layer ? i : -1))
      .filter((i) => i >= 0);
    for (let start = 0; start < indexes.length; start += 3)
      rows.push({ layer, indexes: indexes.slice(start, start + 3) });
  }
  const height =
    264 + rows.length * cardH + Math.max(0, rows.length - 1) * gapY + 74;
  const positions = new Map<number, { x: number; y: number; row: number }>();
  rows.forEach((row, r) => {
    const span = row.indexes.length * cardW + (row.indexes.length - 1) * gapX;
    row.indexes.forEach((i, c) =>
      positions.set(i, {
        x: Math.round((width - span) / 2 + c * (cardW + gapX)),
        y: 264 + r * (cardH + gapY),
        row: r,
      }),
    );
  });
  const geometries: string[] = [];
  const labels: {
    text: string;
    x: number;
    y: number;
    width: number;
    size: number;
    color: string;
    bold?: boolean;
    background?: boolean;
    maxHeight?: number;
    center?: boolean;
  }[] = [];
  labels.push({
    text: "OPEN SOURCE  /  CODE ARCHITECTURE",
    x: 72,
    y: 38,
    width: 1500,
    size: 16,
    color: "#65728c",
    bold: true,
  });
  labels.push({
    text: repo,
    x: 72,
    y: 80,
    width: 1620,
    size: 46,
    color: "#1b2941",
    bold: true,
    maxHeight: 70,
  });
  labels.push({
    text: a.diagramTitle,
    x: 74,
    y: 157,
    width: 1590,
    size: 24,
    color: "#58667f",
    maxHeight: 45,
  });
  geometries.push(
    `<path d="M72 218 H1728" stroke="#dfe5ef" stroke-width="2"/>`,
  );
  for (const [i, e] of a.edges.entries()) {
    const from = positions.get(e.from)!,
      to = positions.get(e.to)!;
    let d = "",
      labelX = 0,
      labelY = 0;
    if (from.row === to.row) {
      const y = from.y - 32 - (i % 3) * 28;
      const x1 = from.x + cardW / 2,
        x2 = to.x + cardW / 2;
      d = `M${x1} ${from.y} V${y} H${x2} V${to.y - 8}`;
      labelX = (x1 + x2) / 2 - 120;
      labelY = y - 18;
    } else if (from.row < to.row) {
      const x1 = from.x + cardW / 2 + ((i % 3) - 1) * 28;
      const x2 = to.x + cardW / 2 + ((i % 3) - 1) * 28;
      const y = from.y + cardH + 58 + (i % 3) * 27;
      if (to.row === from.row + 1)
        d = `M${x1} ${from.y + cardH} V${y} H${x2} V${to.y - 8}`;
      else {
        const side = width - 40 - (i % 3) * 22;
        d = `M${x1} ${from.y + cardH} V${y} H${side} V${to.y - 58} H${x2} V${to.y - 8}`;
      }
      labelX = (x1 + x2) / 2 - 120;
      labelY = y - 17;
    } else {
      const side = 34 + (i % 3) * 22;
      d = `M${from.x} ${from.y + cardH / 2} H${side} V${to.y - 44} H${to.x + cardW / 2} V${to.y - 8}`;
      labelX = side + 20;
      labelY = (from.y + to.y) / 2;
    }
    geometries.push(
      `<path d="${d}" fill="none" stroke="#98a6bc" stroke-width="2.5" stroke-linejoin="round" marker-end="url(#arrow)"/>`,
    );
    if (e.label)
      labels.push({
        text: e.label,
        x: Math.round(labelX),
        y: Math.round(labelY),
        width: 240,
        size: 20,
        color: "#53627c",
        background: true,
        center: true,
        maxHeight: 30,
      });
  }
  for (const row of rows) {
    const palette = colors[row.layer];
    const y = positions.get(row.indexes[0])!.y;
    labels.push({
      text: palette[2],
      x: 76,
      y: y - 33,
      width: 180,
      size: 20,
      color: palette[1],
      bold: true,
    });
    for (const index of row.indexes) {
      const n = a.nodes[index],
        p = positions.get(index)!;
      geometries.push(
        `<rect x="${p.x}" y="${p.y + 5}" width="${cardW}" height="${cardH}" rx="20" fill="#172a42" opacity=".055"/><rect x="${p.x}" y="${p.y}" width="${cardW}" height="${cardH}" rx="20" fill="white" stroke="${palette[1]}" stroke-opacity=".42" stroke-width="2"/><rect x="${p.x + 18}" y="${p.y + 20}" width="6" height="32" rx="3" fill="${palette[1]}"/>`,
      );
      labels.push({
        text: n.label,
        x: p.x + 38,
        y: p.y + 22,
        width: cardW - 62,
        size: 28,
        color: "#23354d",
        bold: true,
        maxHeight: 42,
      });
      labels.push({
        text: n.description,
        x: p.x + 26,
        y: p.y + 70,
        width: cardW - 52,
        size: 20,
        color: "#64748b",
        maxHeight: 56,
      });
      labels.push({
        text:
          n.path.length > 52
            ? "…/" + n.path.split("/").slice(-2).join("/").slice(-48)
            : n.path,
        x: p.x + 26,
        y: p.y + 142,
        width: cardW - 52,
        size: 18,
        color: palette[1],
        maxHeight: 44,
      });
    }
  }
  const base = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#98a6bc"/></marker></defs><rect width="${width}" height="${height}" fill="#f6f8fc"/>${geometries.join("")}</svg>`,
  );
  const overlays: sharp.OverlayOptions[] = [];
  for (const label of labels) {
    let size = label.size;
    const textImage = async () =>
      sharp({
        text: {
          text: `<span foreground="${label.color}"${label.bold ? ' weight="bold"' : ""}>${escape(label.text)}</span>`,
          font: `Noto Sans CJK SC ${size}`,
          fontfile: font,
          width: label.width,
          wrap: "char",
          align: label.center ? "center" : "left",
          rgba: true,
          dpi: 72,
        },
      })
        .png()
        .toBuffer({ resolveWithObject: true });
    let rendered = await textImage();
    while (
      label.maxHeight &&
      rendered.info.height > label.maxHeight &&
      size > 12
    ) {
      size -= 2;
      rendered = await textImage();
    }
    if (label.maxHeight && rendered.info.height > label.maxHeight)
      throw new ApiError(
        422,
        "DIAGRAM_TEXT_OVERFLOW",
        `架构图文字过长，请缩短：${label.text.slice(0, 35)}`,
      );
    const text = label.background
      ? await sharp({
          create: {
            width: rendered.info.width + 16,
            height: rendered.info.height + 8,
            channels: 4,
            background: "#f6f8fc",
          },
        })
          .composite([{ input: rendered.data, left: 8, top: 4 }])
          .png()
          .toBuffer()
      : rendered.data;
    overlays.push({
      input: text,
      left: Math.round(
        label.x +
          (label.center ? (label.width - rendered.info.width) / 2 : 0) -
          (label.background ? 8 : 0),
      ),
      top: label.y - (label.background ? 4 : 0),
    });
  }
  return sharp(base)
    .composite(overlays)
    .png({ compressionLevel: 9 })
    .toBuffer();
}
