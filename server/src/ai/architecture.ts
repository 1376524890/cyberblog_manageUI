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
  entry: ["#e8e8e6", "#565b6b", "入口与交互"],
  core: ["#ffffff", "#565b6b", "核心模块"],
  support: ["#ececea", "#565b6b", "数据与支撑"],
};
const palette = {
  paper: "#f5f5f5",
  paper2: "#efefed",
  ink: "#2d3142",
  muted: "#5c5f6d",
  rule: "rgba(45,49,66,0.20)",
  accent: "#bf4520",
  accentTint: "rgba(191,69,32,0.10)",
};
const snap = (value: number) => Math.ceil(value / 4) * 4;
interface DiagramLabel {
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
}
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
export function buildArchitectureSVG(repo: string, a: Architecture) {
  const width = 960;
  const cardW = 284;
  const cardH = 104;
  const gapX = 24;
  const marginX = 48;
  const top = 104;
  const rowGap = 60;
  const layers = ["entry", "core", "support"] as const;
  const layerNames = {
    entry: "ENTRY / INTERACTION",
    core: "CORE / DOMAIN",
    support: "SUPPORT / DATA",
  };
  const rows = layers
    .map((layer) => {
      const indexes = a.nodes
        .map((n, i) => (n.layer === layer ? i : -1))
        .filter((i) => i >= 0);
      return Array.from(
        { length: Math.ceil(indexes.length / 3) },
        (_, row) => indexes.slice(row * 3, row * 3 + 3),
      );
    })
    .flat();
  const rowTops = rows.map((_, index) => top + index * (cardH + rowGap));
  const positions = new Map<number, { x: number; y: number; row: number }>();
  rows.forEach((indexes, row) => {
    const span =
      indexes.length * cardW +
      (indexes.length > 1 ? (indexes.length - 1) * gapX : 0);
    indexes.forEach((index, column) => {
      positions.set(index, {
        x: snap(
          marginX + (width - marginX * 2 - span) / 2 + column * (cardW + gapX),
        ),
        y: rowTops[row],
        row,
      });
    });
  });
  const bodyHeight =
    rows.length * cardH + Math.max(0, rows.length - 1) * rowGap;
  const height = snap(Math.max(600, top + bodyHeight + 52));
  const geometries: string[] = [];
  const labels: DiagramLabel[] = [
    {
      text: "GITHUB DAILY / ARCHITECTURE",
      x: marginX,
      y: 28,
      width: 480,
      size: 10,
      color: palette.muted,
      bold: true,
    },
    {
      text: repo,
      x: marginX,
      y: 48,
      width: 720,
      size: 28,
      color: palette.ink,
      bold: true,
      maxHeight: 36,
    },
    {
      text: a.diagramTitle,
      x: marginX,
      y: 88,
      width: 760,
      size: 13,
      color: palette.muted,
      maxHeight: 24,
    },
  ];
  geometries.push(
    `<line x1="${marginX}" y1="80" x2="${width - marginX}" y2="80" stroke="${palette.rule}" stroke-width="1"/>`,
  );

  for (const [edgeIndex, edge] of a.edges.entries()) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    let path = "";
    let labelX = 0;
    let labelY = 0;
    const source = { x: from.x + cardW / 2, y: from.y + cardH };
    const target = { x: to.x + cardW / 2, y: to.y - 7 };
    if (from.row === to.row) {
      const x1 = from.x + cardW;
      const x2 = to.x;
      const y = from.y + cardH / 2 + ((edgeIndex % 3) - 1) * 20;
      path = `M ${x1} ${y} H ${x2 - 7}`;
      labelX = (x1 + x2) / 2 - 100;
      labelY = y - 14;
    } else if (to.y > from.y) {
      const midY = snap((source.y + target.y) / 2);
      path = `M ${source.x} ${source.y} V ${midY} H ${target.x} V ${target.y}`;
      labelX = Math.min(
        Math.max(Math.max(source.x, target.x), marginX + 80),
        width - marginX - 200,
      );
      labelY = midY - 15 + (edgeIndex % 2) * 18;
    } else if (to.row === from.row + 1) {
      const side = Math.min(
        width - 20,
        from.x + cardW + 16 + (edgeIndex % 3) * 20,
      );
      path = `M ${from.x + cardW} ${from.y + cardH / 2} H ${side} V ${target.y + cardH / 2} H ${to.x + cardW + 7}`;
      labelX = Math.min(
        Math.max((side + to.x + cardW) / 2 - 100, marginX + 8),
        width - marginX - 208,
      );
      labelY = target.y + cardH / 2 - 14;
    } else {
      const lane = rowTops[from.row] + cardH + 12 + (edgeIndex % 2) * 12;
      const side = width - 20 - (edgeIndex % 3) * 20;
      path = `M ${from.x + cardW} ${from.y + cardH / 2} H ${side} V ${lane} H ${to.x + cardW / 2} V ${target.y}`;
      labelX = Math.min(
        Math.max((side + to.x + cardW / 2) / 2 - 100, marginX + 8),
        width - marginX - 208,
      );
      labelY = lane - 15;
    }
    geometries.push(
      `<path d="${path}" fill="none" stroke="${palette.ink}" stroke-opacity="0.66" stroke-width="1.2" stroke-linejoin="round" marker-end="url(#arrow)"/>`,
    );
    if (edge.label)
      labels.push({
        text: edge.label,
        x: Math.round(labelX),
        y: Math.round(labelY),
        width: 200,
        size: 12,
        color: palette.muted,
        background: true,
        center: true,
        maxHeight: 18,
      });
  }

  let firstCore = true;
  rows.forEach((indexes, row) => {
    const layer = a.nodes[indexes[0]]?.layer ?? "core";
    const y = rowTops[row] - 28;
    const rowBottom = rowTops[row] + cardH + 20;
    geometries.push(
      `<rect data-layer="${layer}" data-role="tier" x="${marginX}" y="${y}" width="${width - marginX * 2}" height="${rowBottom - y}" rx="8" fill="${palette.paper2}" fill-opacity="${layer === "support" ? 0.55 : 0.38}" stroke="${palette.rule}" stroke-dasharray="4,3"/>`,
    );
    labels.push({
      text: layerNames[layer],
      x: marginX + 16,
      y: y + 7,
      width: 260,
      size: 10,
      color: palette.muted,
      bold: true,
    });
    indexes.forEach((index) => {
      const node = a.nodes[index];
      const position = positions.get(index)!;
      const focal = layer === "core" && firstCore;
      const fill = focal ? palette.accentTint : colors[layer][0];
      const stroke = focal ? palette.accent : colors[layer][1];
      geometries.push(
        `<rect data-node-index="${index}" data-role="${focal ? "focal" : "node"}" x="${position.x}" y="${position.y}" width="${cardW}" height="${cardH}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${focal ? 1.2 : 1}"/>`,
      );
      labels.push(
        {
          text: node.label,
          x: position.x + 16,
          y: position.y + 15,
          width: cardW - 32,
          size: 14,
          color: palette.ink,
          bold: true,
          maxHeight: 22,
        },
        {
          text: node.description,
          x: position.x + 16,
          y: position.y + 42,
          width: cardW - 32,
          size: 11,
          color: palette.muted,
          maxHeight: 31,
        },
        {
          text:
            node.path.length > 44
              ? "…/" + node.path.split("/").slice(-2).join("/").slice(-40)
              : node.path,
          x: position.x + 16,
          y: position.y + 79,
          width: cardW - 32,
          size: 12,
          color: focal ? palette.accent : palette.muted,
          maxHeight: 20,
        },
      );
      if (focal) firstCore = false;
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-grammar="architecture" data-source="diagram-design"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${palette.ink}" fill-opacity="0.75"/></marker></defs><rect width="${width}" height="${height}" fill="${palette.paper}"/>${geometries.join("")}</svg>`;
  return { svg, width, height, labels };
}

export async function renderArchitecturePNG(
  repo: string,
  a: Architecture,
): Promise<Buffer> {
  const font = await diagramFont();
  const { svg, width, height, labels } = buildArchitectureSVG(repo, a);
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
            background: palette.paper,
          },
        })
          .composite([{ input: rendered.data, left: 8, top: 4 }])
          .png()
          .toBuffer()
      : await sharp({
          create: {
            width: rendered.info.width,
            height: rendered.info.height,
            channels: 4,
            background: palette.paper,
          },
        })
          .composite([{ input: rendered.data, left: 0, top: 0 }])
          .png()
          .toBuffer();
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
  const renderedCanvas = await sharp(Buffer.from(svg))
    .composite(overlays)
    .png()
    .toBuffer();
  return sharp(renderedCanvas)
    .resize(width * 2, height * 2)
    .png({ compressionLevel: 9 })
    .toBuffer();
}
