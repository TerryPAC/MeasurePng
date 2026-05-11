import {
  IMAGE_BORDER_OFFSET,
  MIN_AREA_PIXELS,
  MIN_AREA_WIDTH
} from './constants.js';
import { detectQuadrilateralVertices } from './quadDetector.js';

/**
 * Core detection algorithm — no DOM dependency.
 * @param {Uint8ClampedArray|Uint8Array} data  flat RGBA pixel buffer
 * @param {number} w  image width in pixels
 * @param {number} h  image height in pixels
 * @param {number} alphaThreshold  pixels with alpha < threshold are considered transparent
 * @returns {Array<{x,y,width,height,vertices,houghLines}>}
 */
export function detectTransparentAreaCore(data, w, h, alphaThreshold) {
  const visited = new Array(w * h).fill(false);
  let areas = [];

  const floodFill = (startX, startY) => {
    const area = { minX: startX, minY: startY, maxX: startX, maxY: startY, pixels: 0, boundaryPixels: [] };
    const stack = [[startX, startY]];

    while (stack.length > 0) {
      const [x, y] = stack.pop();
      const index = y * w + x;
      if (x < IMAGE_BORDER_OFFSET || x >= w - IMAGE_BORDER_OFFSET ||
        y < IMAGE_BORDER_OFFSET || y >= h - IMAGE_BORDER_OFFSET ||
        visited[index]) {
        continue;
      }

      if (data[index * 4 + 3] >= alphaThreshold) {
        visited[index] = true;
        continue;
      }

      visited[index] = true;
      area.pixels++;
      area.minX = Math.min(area.minX, x);
      area.minY = Math.min(area.minY, y);
      area.maxX = Math.max(area.maxX, x);
      area.maxY = Math.max(area.maxY, y);

      const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h &&
          data[(ny * w + nx) * 4 + 3] >= alphaThreshold) {
          area.boundaryPixels.push({ x, y });
          break;
        }
      }

      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return area;
  };

  for (let y = IMAGE_BORDER_OFFSET; y < h - IMAGE_BORDER_OFFSET; y++) {
    for (let x = IMAGE_BORDER_OFFSET; x < w - IMAGE_BORDER_OFFSET; x++) {
      const index = y * w + x;
      if (!visited[index] && data[index * 4 + 3] < alphaThreshold) {
        const area = floodFill(x, y);
        if (area.pixels > MIN_AREA_PIXELS
          && area.maxX - area.minX > MIN_AREA_WIDTH
          && area.maxY - area.minY > MIN_AREA_WIDTH) {
          areas.push(area);
        }
      }
    }
  }

  if (areas.length === 0) {
    const fallbackMargin = IMAGE_BORDER_OFFSET * 2;
    return [{
      x: fallbackMargin,
      y: fallbackMargin,
      width: w - fallbackMargin * 2,
      height: h - fallbackMargin * 2,
      vertices: null,
      houghLines: null,
    }];
  }

  if (areas.length > 1) {
    const largestArea = areas.reduce((max, item) => item.pixels > max.pixels ? item : max, areas[0]);
    areas = areas.filter(area => area === largestArea || !isAreaContained(largestArea, area));
  }

  areas.sort((a, b) => {
    if (Math.abs(a.minY - b.minY) > 5) {
      return a.minY - b.minY;
    }
    return a.minX - b.minX;
  });

  return areas.map(area => {
    let detection = null;
    try {
      detection = detectQuadrilateralVertices(area.boundaryPixels, w, h, data, alphaThreshold);
    } catch (e) {
      console.error('Quadrilateral vertex detection failed:', e);
    }
    return {
      x: area.minX - 1,
      y: area.minY - 1,
      width: area.maxX - area.minX + 2,
      height: area.maxY - area.minY + 2,
      vertices: detection ? detection.vertices : null,
      houghLines: detection ? detection.houghLines : null,
    };
  });
}

/** Browser wrapper: draws img to an offscreen canvas, then delegates to detectTransparentAreaCore. */
export function detectTransparentArea(img, alphaThreshold) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return detectTransparentAreaCore(data, canvas.width, canvas.height, alphaThreshold);
}

export function isAreaContained(containerArea, containedArea) {
  return containerArea.minX <= containedArea.minX &&
    containerArea.minY <= containedArea.minY &&
    containerArea.maxX >= containedArea.maxX &&
    containerArea.maxY >= containedArea.maxY;
}
