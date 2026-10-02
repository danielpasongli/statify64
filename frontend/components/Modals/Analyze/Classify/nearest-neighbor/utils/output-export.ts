/**
 * Download helpers for KNN output in the result viewer.
 *
 * Tables are exported from the rendered <table> elements, so merged cells,
 * headers and rounding match what is on screen. Charts are converted from
 * their rendered DOM (HTML titles/legends + SVG plots + WebGL canvas) into a
 * standalone vector SVG, which is then rasterized for PNG and JPG.
 */
import * as XLSX from "xlsx";

export type TableDownloadFormat = "xlsx" | "csv";
export type ImageDownloadFormat = "png" | "jpg" | "svg";

/* =========================
   FILES
========================= */

export function toFileBaseName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `knn-${slug || "output"}`;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =========================
   TABLES
========================= */

// Plain numbers as the formatter prints them ("0.215", "-3", "1.230E-5");
// numbers with a leading zero such as "007" stay text (e.g. case labels).
const NUMBER_PATTERN = /^[-+]?(?:0|[1-9]\d*)(?:\.(\d+))?(?:[eE][-+]?\d+)?$/;
const PERCENT_PATTERN = /^([-+]?(?:0|[1-9]\d*)(?:\.(\d+))?)%$/;

function decimalFormat(decimals: number, suffix = ""): string {
  return decimals > 0 ? `0.${"0".repeat(decimals)}${suffix}` : `0${suffix}`;
}

/**
 * Turns numeric-looking text into real Excel numbers while keeping the
 * number of decimals shown on screen ("12.9%" -> 0.129 formatted 0.0%).
 */
function convertNumericCells(sheet: XLSX.WorkSheet) {
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = sheet[address] as XLSX.CellObject;
    if (cell.t !== "s" || typeof cell.v !== "string") continue;

    const text = cell.v.trim();
    const percent = PERCENT_PATTERN.exec(text);
    if (percent) {
      sheet[address] = {
        t: "n",
        v: Number(percent[1]) / 100,
        z: decimalFormat(percent[2]?.length ?? 0, "%"),
      };
      continue;
    }

    const number = NUMBER_PATTERN.exec(text);
    if (number) {
      const isScientific = /e/i.test(text);
      sheet[address] = isScientific
        ? { t: "n", v: Number(text) }
        : { t: "n", v: Number(text), z: decimalFormat(number[1]?.length ?? 0) };
    }
  }
}

function setColumnWidths(sheet: XLSX.WorkSheet) {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const merged = new Set<string>();
  for (const merge of sheet["!merges"] ?? []) {
    // Wide merged titles should not stretch a single column.
    if (merge.e.c > merge.s.c) merged.add(XLSX.utils.encode_cell(merge.s));
  }

  const widths: { wch: number }[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    let width = 6;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address] as XLSX.CellObject | undefined;
      if (!cell || merged.has(address)) continue;
      width = Math.max(width, String(cell.v ?? "").length + 2);
    }
    widths.push({ wch: Math.min(width, 60) });
  }
  sheet["!cols"] = widths;
}

function rawTableSheet(table: HTMLTableElement): XLSX.WorkSheet {
  // raw: keep cell text exactly as displayed (no date/number guessing).
  return XLSX.utils.table_to_sheet(table, { raw: true });
}

export function tableToSheet(table: HTMLTableElement): XLSX.WorkSheet {
  const sheet = rawTableSheet(table);
  convertNumericCells(sheet);
  setColumnWidths(sheet);
  return sheet;
}

function uniqueSheetName(title: string, used: Set<string>): string {
  const base =
    title.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) ||
    "Table";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

export function tablesToWorkbook(
  tables: HTMLTableElement[],
  title: string,
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const used = new Set<string>();
  tables.forEach((table, index) => {
    const sheetTitle = tables.length > 1 ? `${title} ${index + 1}` : title;
    XLSX.utils.book_append_sheet(
      workbook,
      tableToSheet(table),
      uniqueSheetName(sheetTitle, used),
    );
  });
  return workbook;
}

/**
 * Row headers merged across several rows are repeated on every row in CSV,
 * so each line stays self-describing when the file is filtered or sorted.
 */
function fillRowSpans(sheet: XLSX.WorkSheet) {
  for (const merge of sheet["!merges"] ?? []) {
    if (merge.e.r === merge.s.r) continue;
    const origin = sheet[XLSX.utils.encode_cell(merge.s)] as
      | XLSX.CellObject
      | undefined;
    if (!origin) continue;
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        if (!sheet[address]) sheet[address] = { ...origin };
      }
    }
  }
}

export function tablesToCsv(tables: HTMLTableElement[]): string {
  const parts = tables.map((table) => {
    const sheet = rawTableSheet(table);
    fillRowSpans(sheet);
    return XLSX.utils.sheet_to_csv(sheet, { RS: "\r\n", blankrows: false });
  });
  // BOM so Excel opens UTF-8 text (e.g. "Δ", "≤") correctly.
  return `﻿${parts.join("\r\n\r\n")}\r\n`;
}

export function downloadTables(
  tables: HTMLTableElement[],
  format: TableDownloadFormat,
  title: string,
) {
  if (tables.length === 0) throw new Error("No table found to download.");
  const baseName = toFileBaseName(title);

  if (format === "csv") {
    downloadBlob(
      new Blob([tablesToCsv(tables)], { type: "text/csv;charset=utf-8" }),
      `${baseName}.csv`,
    );
    return;
  }

  const data = XLSX.write(tablesToWorkbook(tables, title), {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
  downloadBlob(
    new Blob([data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${baseName}.xlsx`,
  );
}

/* =========================
   CHARTS: DOM -> SVG
========================= */

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const SKIPPED_TAGS = new Set([
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
]);
// Presentation properties copied from the page onto the exported SVG, so the
// file does not depend on the app's CSS classes.
const SVG_STYLE_PROPERTIES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
] as const;
const EXPORT_PADDING = 12;
const FALLBACK_FONTS = "Arial, Helvetica, sans-serif";

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Web fonts registered by the page (e.g. next/font names like "__Inter_ab12")
 * are unavailable once the SVG leaves the page, so they are dropped and a
 * common sans-serif stack is appended.
 */
export function portableFontFamily(fontFamily: string): string {
  const families = fontFamily
    .split(",")
    .map((family) => family.trim())
    .filter((family) => family && !/^['"]?__/.test(family));
  return [...families, FALLBACK_FONTS].join(", ");
}

function isTransparent(color: string): boolean {
  if (!color || color === "transparent") return true;
  const match = /rgba?\(([^)]+)\)/.exec(color);
  if (!match) return false;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length === 4 && Number(parts[3]) === 0;
}

function isHidden(style: CSSStyleDeclaration): boolean {
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  );
}

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export type LinearGradient = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: { offset: number; color: string }[];
};

const SIDE_ANGLES: Record<string, number> = {
  "to top": 0,
  "to right": 90,
  "to bottom": 180,
  "to left": 270,
};

/**
 * Parses a computed CSS `linear-gradient(...)` into SVG gradient geometry
 * (objectBoundingBox units). Returns null for anything else.
 */
export function parseLinearGradient(backgroundImage: string): LinearGradient | null {
  const match = /^linear-gradient\((.*)\)$/.exec(backgroundImage.trim());
  if (!match) return null;

  const parts = splitTopLevel(match[1]);
  let angle = 180; // CSS default: to bottom
  const first = parts[0]?.toLowerCase() ?? "";
  if (first.startsWith("to ")) {
    angle = SIDE_ANGLES[first] ?? angle;
    parts.shift();
  } else if (/^-?[\d.]+deg$/.test(first)) {
    angle = parseFloat(first);
    parts.shift();
  }

  const stops = parts.map((part) => {
    const stop = /^(.*?)(?:\s+(-?[\d.]+)%)?$/.exec(part);
    return {
      color: (stop?.[1] ?? part).trim(),
      offset: stop?.[2] === undefined ? Number.NaN : Number(stop[2]) / 100,
    };
  });
  if (stops.length < 2) return null;
  // Stops without a position are spread evenly, as in CSS.
  stops.forEach((stop, index) => {
    if (Number.isNaN(stop.offset)) stop.offset = index / (stops.length - 1);
  });

  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians) / 2;
  const dy = -Math.cos(radians) / 2;
  return {
    x1: round(0.5 - dx),
    y1: round(0.5 - dy),
    x2: round(0.5 + dx),
    y2: round(0.5 + dy),
    stops,
  };
}

class SvgBuilder {
  readonly parts: string[] = [];
  private gradientCount = 0;
  private box: Box = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  private measureContext: CanvasRenderingContext2D | null = null;

  constructor(private readonly origin: DOMRect) {}

  get bounds(): Box {
    return this.box;
  }

  private include(left: number, top: number, width: number, height: number) {
    if (!(width > 0) || !(height > 0)) return;
    this.box = {
      minX: Math.min(this.box.minX, left),
      minY: Math.min(this.box.minY, top),
      maxX: Math.max(this.box.maxX, left + width),
      maxY: Math.max(this.box.maxY, top + height),
    };
  }

  private x(rect: { left: number }) {
    return rect.left - this.origin.left;
  }

  private y(rect: { top: number }) {
    return rect.top - this.origin.top;
  }

  private addLinearGradient(backgroundImage: string): string | null {
    const gradient = parseLinearGradient(backgroundImage);
    if (!gradient) return null;

    const id = `knn-export-gradient-${++this.gradientCount}`;
    const stops = gradient.stops
      .map((stop) => `<stop offset="${round(stop.offset)}" stop-color="${stop.color}"/>`)
      .join("");
    this.parts.push(
      `<defs><linearGradient id="${id}" x1="${gradient.x1}" y1="${gradient.y1}" x2="${gradient.x2}" y2="${gradient.y2}">${stops}</linearGradient></defs>`,
    );
    return id;
  }

  addElementBox(element: Element, style: CSSStyleDeclaration) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = this.x(rect);
    const y = this.y(rect);
    const radius = parseFloat(style.borderTopLeftRadius) || 0;
    const background = style.backgroundColor;
    const hasBackground = !isTransparent(background);

    const sides = (["Top", "Right", "Bottom", "Left"] as const).map((side) => ({
      side,
      width: parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0,
      color: style.getPropertyValue(`border-${side.toLowerCase()}-color`),
      lineStyle: style.getPropertyValue(`border-${side.toLowerCase()}-style`),
    }));
    const visibleSides = sides.filter(
      (side) => side.width > 0 && side.lineStyle !== "none" && !isTransparent(side.color),
    );
    const uniformBorder =
      visibleSides.length === 4 &&
      visibleSides.every(
        (side) => side.width === visibleSides[0].width && side.color === visibleSides[0].color,
      );

    const gradientId = this.addLinearGradient(style.backgroundImage);
    const box = (fill: string, inset: number, stroke = "") =>
      [
        `<rect x="${round(x + inset)}" y="${round(y + inset)}"`,
        `width="${round(rect.width - inset * 2)}" height="${round(rect.height - inset * 2)}"`,
        radius > 0 ? `rx="${round(radius)}"` : "",
        `fill="${fill}"${stroke}/>`,
      ]
        .filter(Boolean)
        .join(" ");

    if (hasBackground) this.parts.push(box(background, 0));
    // e.g. the continuous target color scale in the Predictor Space legend.
    if (gradientId) this.parts.push(box(`url(#${gradientId})`, 0));
    if (uniformBorder) {
      const border = visibleSides[0];
      this.parts.push(
        box("none", border.width / 2, ` stroke="${border.color}" stroke-width="${border.width}"`),
      );
    }
    if (hasBackground || gradientId || uniformBorder) {
      this.include(x, y, rect.width, rect.height);
    }

    if (!uniformBorder) {
      for (const side of visibleSides) {
        const half = side.width / 2;
        const [x1, y1, x2, y2] =
          side.side === "Top"
            ? [x, y + half, x + rect.width, y + half]
            : side.side === "Bottom"
              ? [x, y + rect.height - half, x + rect.width, y + rect.height - half]
              : side.side === "Left"
                ? [x + half, y, x + half, y + rect.height]
                : [x + rect.width - half, y, x + rect.width - half, y + rect.height];
        this.parts.push(
          `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${side.color}" stroke-width="${side.width}"/>`,
        );
        this.include(x, y, rect.width, rect.height);
      }
    }
  }

  private fontAscent(style: CSSStyleDeclaration): number {
    const fontSize = parseFloat(style.fontSize) || 12;
    try {
      this.measureContext ??= document.createElement("canvas").getContext("2d");
      if (this.measureContext) {
        this.measureContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = this.measureContext.measureText("Mg");
        if (metrics.fontBoundingBoxAscent > 0) return metrics.fontBoundingBoxAscent;
      }
    } catch {
      // Fall through to the estimate below.
    }
    return fontSize * 0.8;
  }

  addText(node: Text, style: CSSStyleDeclaration) {
    const raw = node.textContent ?? "";
    if (!raw.trim()) return;

    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    if (rects.length === 0) return;

    // One entry per rendered line; wrapped text is split word by word.
    const lines: { text: string; rect: DOMRect }[] = [];
    if (rects.length === 1) {
      // Measure without surrounding spaces: React often splits one line into
      // several text nodes ("K =", " ", "5"), whose spaces must stay gaps.
      const start = raw.search(/\S/);
      const end = raw.length - (raw.length - raw.trimEnd().length);
      range.setStart(node, start);
      range.setEnd(node, end);
      lines.push({ text: raw.replace(/\s+/g, " ").trim(), rect: range.getBoundingClientRect() });
    } else {
      const wordPattern = /\S+/g;
      let match: RegExpExecArray | null;
      while ((match = wordPattern.exec(raw))) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const wordRect = range.getBoundingClientRect();
        const line = lines[lines.length - 1];
        if (line && Math.abs(line.rect.top - wordRect.top) < 2) {
          line.text += ` ${match[0]}`;
          line.rect = new DOMRect(
            line.rect.left,
            line.rect.top,
            wordRect.right - line.rect.left,
            Math.max(line.rect.height, wordRect.height),
          );
        } else {
          lines.push({ text: match[0], rect: wordRect });
        }
      }
    }

    const transform = style.textTransform;
    // Center/right anchoring only holds when the node is the whole line;
    // pieces of a mixed line keep their measured left edge.
    const isOnlyContent =
      Array.from(node.parentNode?.childNodes ?? []).filter(
        (child) => child === node || (child.textContent ?? "").trim() !== "",
      ).length === 1;
    const align = isOnlyContent ? style.textAlign : "start";
    const ascent = this.fontAscent(style);
    const common = [
      `font-family="${escapeXml(portableFontFamily(style.fontFamily))}"`,
      `font-size="${style.fontSize}"`,
      style.fontWeight !== "400" && style.fontWeight !== "normal"
        ? `font-weight="${style.fontWeight}"`
        : "",
      style.fontStyle === "italic" ? `font-style="italic"` : "",
      `fill="${style.color}"`,
    ].filter(Boolean);

    for (const { text, rect } of lines) {
      const content =
        transform === "uppercase"
          ? text.toUpperCase()
          : transform === "lowercase"
            ? text.toLowerCase()
            : text;
      // Anchor centered/right text on its measured edge, so the layout holds
      // even when the viewer substitutes a font with different widths.
      const [anchor, anchorX] =
        align === "center"
          ? ["middle", rect.left + rect.width / 2]
          : align === "right" || align === "end"
            ? ["end", rect.right]
            : ["start", rect.left];
      const x = anchorX - this.origin.left;
      const baseline = this.y(rect) + ascent;
      this.parts.push(
        `<text x="${round(x)}" y="${round(baseline)}"${anchor === "start" ? "" : ` text-anchor="${anchor}"`} ${common.join(" ")} xml:space="preserve">${escapeXml(content)}</text>`,
      );
      this.include(this.x(rect), this.y(rect), rect.width, rect.height);
    }
  }

  addSvg(svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    inlineSvgStyles(svg, clone);
    clone.removeAttribute("class");
    clone.removeAttribute("style");
    clone.setAttribute("x", String(round(this.x(rect))));
    clone.setAttribute("y", String(round(this.y(rect))));
    clone.setAttribute("width", String(round(rect.width)));
    clone.setAttribute("height", String(round(rect.height)));
    clone.setAttribute("overflow", "visible");
    this.parts.push(new XMLSerializer().serializeToString(clone));

    // Include drawing that overflows the <svg> box (e.g. axis titles).
    this.include(this.x(rect), this.y(rect), rect.width, rect.height);
    try {
      const content = svg.getBBox();
      const viewBox = svg.viewBox?.baseVal;
      const scaleX = viewBox && viewBox.width > 0 ? rect.width / viewBox.width : 1;
      const scaleY = viewBox && viewBox.height > 0 ? rect.height / viewBox.height : 1;
      const offsetX = viewBox && viewBox.width > 0 ? viewBox.x : 0;
      const offsetY = viewBox && viewBox.height > 0 ? viewBox.y : 0;
      this.include(
        this.x(rect) + (content.x - offsetX) * scaleX,
        this.y(rect) + (content.y - offsetY) * scaleY,
        content.width * scaleX,
        content.height * scaleY,
      );
    } catch {
      // getBBox is unavailable for undisplayed SVGs; the box above suffices.
    }
  }

  addCanvas(canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      return; // Tainted canvas: nothing we can export.
    }
    const x = round(this.x(rect));
    const y = round(this.y(rect));
    const href = escapeXml(dataUrl);
    this.parts.push(
      `<image x="${x}" y="${y}" width="${round(rect.width)}" height="${round(rect.height)}" href="${href}" xlink:href="${href}" preserveAspectRatio="none"/>`,
    );
    this.include(this.x(rect), this.y(rect), rect.width, rect.height);
  }
}

function inlineSvgStyles(source: Element, target: Element) {
  const style = window.getComputedStyle(source);
  if (style.display === "none" || style.visibility === "hidden") {
    target.remove();
    return;
  }

  if (source instanceof SVGElement) {
    for (const property of SVG_STYLE_PROPERTIES) {
      let value = style.getPropertyValue(property);
      if (!value) continue;
      if (property === "font-family") value = portableFontFamily(value);
      target.setAttribute(property, value);
    }
    target.removeAttribute("class");
  }

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  sourceChildren.forEach((child, index) => {
    const targetChild = targetChildren[index];
    if (targetChild) inlineSvgStyles(child, targetChild);
  });
}

function walk(node: Node, builder: SvgBuilder) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (parent) builder.addText(node as Text, window.getComputedStyle(parent));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as Element;
  if (SKIPPED_TAGS.has(element.tagName) || element.hasAttribute("data-export-ignore")) {
    return;
  }

  const style = window.getComputedStyle(element);
  if (isHidden(style)) return;

  if (element instanceof SVGSVGElement) {
    builder.addSvg(element);
    return;
  }
  if (element instanceof HTMLCanvasElement) {
    builder.addCanvas(element);
    return;
  }

  builder.addElementBox(element, style);
  element.childNodes.forEach((child) => walk(child, builder));
}

export type SvgExport = { svg: string; width: number; height: number };

const CONTROL_SELECTOR = "[data-export-ignore], button, input, select, textarea";

/**
 * Collapses interactive controls (k input, axis pickers, buttons) while the
 * chart is read, so the image has no empty gaps where they were. Everything
 * runs synchronously, so the page never paints the collapsed layout.
 */
function withControlsCollapsed<T>(root: HTMLElement, read: () => T): T {
  const controls = Array.from(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR));
  const previous = controls.map((control) => [
    control.style.getPropertyValue("display"),
    control.style.getPropertyPriority("display"),
  ]);
  controls.forEach((control) => control.style.setProperty("display", "none", "important"));
  try {
    return read();
  } finally {
    controls.forEach((control, index) => {
      const [value, priority] = previous[index];
      if (value) control.style.setProperty("display", value, priority);
      else control.style.removeProperty("display");
    });
  }
}

/** Converts a rendered chart (HTML + SVG + canvas) into a standalone SVG. */
export function elementToSvg(root: HTMLElement): SvgExport {
  return withControlsCollapsed(root, () => buildSvg(root));
}

function buildSvg(root: HTMLElement): SvgExport {
  const builder = new SvgBuilder(root.getBoundingClientRect());
  walk(root, builder);

  const bounds = builder.bounds;
  if (!Number.isFinite(bounds.minX)) throw new Error("The chart has nothing to export.");

  const x = Math.floor(bounds.minX - EXPORT_PADDING);
  const y = Math.floor(bounds.minY - EXPORT_PADDING);
  const width = Math.ceil(bounds.maxX + EXPORT_PADDING) - x;
  const height = Math.ceil(bounds.maxY + EXPORT_PADDING) - y;

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" version="1.1" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/>` +
    builder.parts.join("") +
    `</svg>`;

  return { svg, width, height };
}

/* =========================
   CHARTS: SVG -> PNG / JPG
========================= */

export async function svgToRasterBlob(
  { svg, width, height }: SvgExport,
  format: "png" | "jpg",
  scale = 2,
): Promise<Blob> {
  const image = new Image();
  image.decoding = "sync";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The chart image could not be rendered."));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available in this browser.");

  // White background for both formats so the image reads well in documents.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const mime = format === "png" ? "image/png" : "image/jpeg";
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Image encoding failed."))),
      mime,
      0.95,
    );
  });
}

export async function downloadChart(
  root: HTMLElement,
  format: ImageDownloadFormat,
  title: string,
) {
  const exported = elementToSvg(root);
  const baseName = toFileBaseName(title);

  if (format === "svg") {
    downloadBlob(
      new Blob([exported.svg], { type: "image/svg+xml;charset=utf-8" }),
      `${baseName}.svg`,
    );
    return;
  }

  const blob = await svgToRasterBlob(exported, format);
  downloadBlob(blob, `${baseName}.${format}`);
}
