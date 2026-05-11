#!/usr/bin/env node
/**
 * measure-overlay — detect transparent areas in an overlay image and output the
 * same three JSON sections shown in the MeasurePng web tool:
 *   po         — normalised PO coordinates  { x, y, w, h }
 *   template   — pixel template coordinates { width, height, left, top, right, bottom }
 *   positions  — pixel corner coordinates   { tlx, tly, trx, try, blx, bly, brx, bry }
 *
 * Usage:
 *   measure-png-overlay --input <path> [--product-width <n>] [--product-height <n>] [--bleed <n>]
 *
 * Options:
 *   --input          Path to the overlay image (PNG recommended; JPEG/WebP accepted)
 *   --product-width  Product width in any unit (optional; enables aspect-ratio fit)
 *   --product-height Product height in the same unit (optional)
 *   --bleed          Bleed value in the same unit as product width (optional, default 0)
 *   --help           Show this message
 *
 * When --product-width and --product-height are omitted the detected transparent
 * rectangle is used directly, matching the web tool's "no product dimensions" path.
 *
 * Debug logs go to stderr. stdout contains only the JSON result.
 */

import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Argument parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
`Usage: measure-png-overlay --input <path> [--product-width <n>] [--product-height <n>] [--bleed <n>]

Options:
  --input          Image file path (PNG/JPEG/WebP)
  --product-width  Product width  (enables aspect-ratio + bleed fit)
  --product-height Product height (same unit as product-width)
  --bleed          Bleed value    (same unit as product-width, default 0)
  --help           This message
`);
  process.exit(0);
}

function getArg(flag, defaultValue) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : defaultValue;
}

const inputPath    = getArg('--input', null);
const productWidth = getArg('--product-width', null);
const productHeight= getArg('--product-height', null);
const bleedRaw     = getArg('--bleed', '0');

if (!inputPath) {
  process.stderr.write('Error: --input <path> is required.\nRun with --help for usage.\n');
  process.exit(1);
}

const resolvedPath = path.resolve(inputPath);
if (!existsSync(resolvedPath)) {
  process.stderr.write(`Error: file not found: ${resolvedPath}\n`);
  process.exit(1);
}

// ── Load sharp ────────────────────────────────────────────────────────────────
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  process.stderr.write('Error: sharp is not installed. Run: npm install sharp\n');
  process.exit(1);
}

process.stderr.write(`[measure-png-overlay] input: ${resolvedPath}\n`);
if (productWidth && productHeight) {
  process.stderr.write(`[measure-png-overlay] product: ${productWidth} x ${productHeight}, bleed: ${bleedRaw}\n`);
}

// Decode image to raw RGBA
const { data, info } = await sharp(resolvedPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width: imgWidth, height: imgHeight } = info;
process.stderr.write(`[measure-png-overlay] decoded: ${imgWidth}x${imgHeight}\n`);

// ── Detection ─────────────────────────────────────────────────────────────────
const jsDir = path.resolve(__dirname, '..', 'js');
const { detectTransparentAreaCore } = await import(path.join(jsDir, 'imageProcessor.js'));

const ALPHA_THRESHOLD = 192;
const transparentRects = detectTransparentAreaCore(data, imgWidth, imgHeight, ALPHA_THRESHOLD);

// ── Aspect-ratio + bleed fit (mirrors _confirmSelection / _calculateAspectRatioRect) ──
function calculateAspectRatioRect(transparentArea, aspectRatio, bleedRatio, alignment = 'center') {
  const { x, y, width, height } = transparentArea;
  let newWidth, newHeight;
  if (width / height > aspectRatio) {
    newWidth  = width;
    newHeight = newWidth / aspectRatio;
  } else {
    newHeight = height;
    newWidth  = newHeight * aspectRatio;
  }

  const bleeding    = newWidth * bleedRatio;
  const finalWidth  = newWidth  + 2 * bleeding;
  const finalHeight = newHeight + 2 * bleeding;

  let finalX, finalY;
  switch (alignment) {
    case 'left':   finalX = x - bleeding; break;
    case 'right':  finalX = x + width - finalWidth + bleeding; break;
    default:       finalX = x + (width  - finalWidth)  / 2; break;
  }
  switch (alignment) {
    case 'top':    finalY = y - bleeding; break;
    case 'bottom': finalY = y + height - finalHeight + bleeding; break;
    default:       finalY = y + (height - finalHeight) / 2; break;
  }

  return { x: finalX, y: finalY, width: finalWidth, height: finalHeight };
}

const hasProductDimensions = productWidth != null && productHeight != null;
let finalRects;
if (hasProductDimensions) {
  const aspectRatio = parseFloat(productWidth) / parseFloat(productHeight);
  const bleedValue  = parseFloat(bleedRaw) || 0;
  const bleedRatio  = bleedValue / parseFloat(productWidth);
  finalRects = transparentRects.map(r => calculateAspectRatioRect(r, aspectRatio, bleedRatio));
} else {
  finalRects = transparentRects.map(r => ({ ...r }));
}

// ── Corners (mirrors _initializeCorners) ─────────────────────────────────────
// Use Hough-detected vertices when available; fall back to finalRect corners.
const cornerSets = finalRects.map((rect, i) => {
  const tr = transparentRects[i];
  if (tr && tr.vertices) {
    return tr.vertices.map(v => ({ x: v.x, y: v.y }));
  }
  return [
    { x: rect.x,              y: rect.y               },
    { x: rect.x + rect.width, y: rect.y               },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x,              y: rect.y + rect.height },
  ];
});

// ── Build the three JSON sections (mirrors _updateInfoPanels + _calculateAndDisplayMargins) ──
const toFloat = (value, precision = 4) => parseFloat(value.toFixed(precision));

const poInfos = finalRects.map((rect, i) => {
  const [tl, tr, br, bl] = cornerSets[i];
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  // Use rounded pixel offsets for margins to match web tool
  const m = [
    Math.round(tl.x) - Math.round(left),
    Math.round(tl.y) - Math.round(top),
    Math.round(tr.x) - Math.round(right),
    Math.round(tr.y) - Math.round(top),
    Math.round(br.x) - Math.round(right),
    Math.round(br.y) - Math.round(bottom),
    Math.round(bl.x) - Math.round(left),
    Math.round(bl.y) - Math.round(bottom),
  ];

  return {
    x: toFloat(rect.x         / imgWidth),
    y: toFloat(rect.y         / imgHeight),
    w: toFloat(rect.width     / imgWidth),
    h: toFloat(rect.height    / imgHeight),
    margins: m.map((v, idx) => toFloat(v / (idx % 2 === 0 ? imgWidth : imgHeight), 6))
  };
});

const templateInfos = finalRects.map((rect, i) => {
  const [tl, tr, br, bl] = cornerSets[i];
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  return {
    width:  imgWidth,
    height: imgHeight,
    left:   Math.round(left),
    top:    Math.round(top),
    right:  Math.round(right),
    bottom: Math.round(bottom),
    margins: [
      Math.round(tl.x - left),
      Math.round(tl.y - top),
      Math.round(tr.x - right),
      Math.round(tr.y - top),
      Math.round(br.x - right),
      Math.round(br.y - bottom),
      Math.round(bl.x - left),
      Math.round(bl.y - bottom),
    ]
  };
});

const positionsInfos = cornerSets.map(([tl, tr, br, bl]) => ({
  tlx: Math.round(tl.x), tly: Math.round(tl.y),
  trx: Math.round(tr.x), try: Math.round(tr.y),
  blx: Math.round(bl.x), bly: Math.round(bl.y),
  brx: Math.round(br.x), bry: Math.round(br.y),
}));

// Single-area: unwrap arrays to match web tool behaviour
const single = poInfos.length === 1;
const output = {
  po:        single ? poInfos[0]        : poInfos,
  template:  single ? templateInfos[0]  : templateInfos,
  positions: single ? positionsInfos[0] : positionsInfos,
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
