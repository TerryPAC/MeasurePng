// Utility functions
export const toFloat = (value, precision = 6) => parseFloat(value.toFixed(precision));

export const rotatePoint = (point, center, angle) => {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + (dx * cos - dy * sin),
    y: center.y + (dx * sin + dy * cos)
  };
};

export const scalePoint = (point, center, scale) => {
  return {
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale
  };
};

export const pointToLineDistance = (point, line) => {
  const A = point.x - line.x1;
  const B = point.y - line.y1;
  const C = line.x2 - line.x1;
  const D = line.y2 - line.y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = lenSq !== 0 ? dot / lenSq : -1;

  let xx, yy;

  if (param < 0) {
    xx = line.x1;
    yy = line.y1;
  } else if (param > 1) {
    xx = line.x2;
    yy = line.y2;
  } else {
    xx = line.x1 + param * C;
    yy = line.y1 + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;

  return Math.sqrt(dx * dx + dy * dy);
};
