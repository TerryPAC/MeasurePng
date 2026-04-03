import {
  IMAGE_BORDER_OFFSET,
  MIN_AREA_PIXELS,
  MIN_AREA_WIDTH
} from './constants.js';

export function detectTransparentArea(img, alphaThreshold) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const visited = new Array(canvas.width * canvas.height).fill(false);
  let areas = [];

  const floodFill = (startX, startY) => {
    const area = { minX: startX, minY: startY, maxX: startX, maxY: startY, pixels: 0 };
    const stack = [[startX, startY]];

    while (stack.length > 0) {
      const [x, y] = stack.pop();
      const index = y * canvas.width + x;
      if (x < IMAGE_BORDER_OFFSET || x >= canvas.width - IMAGE_BORDER_OFFSET ||
        y < IMAGE_BORDER_OFFSET || y >= canvas.height - IMAGE_BORDER_OFFSET ||
        visited[index]) {
        continue;
      }

      if (data[(y * canvas.width + x) * 4 + 3] >= alphaThreshold) {
        visited[index] = true;
        continue;
      }

      visited[index] = true;
      area.pixels++;
      area.minX = Math.min(area.minX, x);
      area.minY = Math.min(area.minY, y);
      area.maxX = Math.max(area.maxX, x);
      area.maxY = Math.max(area.maxY, y);

      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return area;
  };

  for (let y = IMAGE_BORDER_OFFSET; y < canvas.height - IMAGE_BORDER_OFFSET; y++) {
    for (let x = IMAGE_BORDER_OFFSET; x < canvas.width - IMAGE_BORDER_OFFSET; x++) {
      const index = y * canvas.width + x;
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
      width: img.width - fallbackMargin * 2,
      height: img.height - fallbackMargin * 2,
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

  return areas.map(area => ({
    x: area.minX - 1,
    y: area.minY - 1,
    width: area.maxX - area.minX + 2,
    height: area.maxY - area.minY + 2,
  }));
}

export function isAreaContained(containerArea, containedArea) {
  return containerArea.minX <= containedArea.minX &&
    containerArea.minY <= containedArea.minY &&
    containerArea.maxX >= containedArea.maxX &&
    containerArea.maxY >= containedArea.maxY;
}
