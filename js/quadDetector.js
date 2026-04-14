export function houghTransform(boundaryPixels, imageWidth, imageHeight) {
  const diagonal = Math.ceil(Math.sqrt(imageWidth * imageWidth + imageHeight * imageHeight));
  const numTheta = 180;
  const numRho = 2 * diagonal + 1;
  const rhoOffset = diagonal;

  const cosTable = new Float64Array(numTheta);
  const sinTable = new Float64Array(numTheta);
  for (let t = 0; t < numTheta; t++) {
    const rad = t * Math.PI / numTheta;
    cosTable[t] = Math.cos(rad);
    sinTable[t] = Math.sin(rad);
  }

  const accumulator = new Int32Array(numRho * numTheta);

  for (let i = 0; i < boundaryPixels.length; i++) {
    const px = boundaryPixels[i].x;
    const py = boundaryPixels[i].y;
    for (let t = 0; t < numTheta; t++) {
      const rho = Math.round(px * cosTable[t] + py * sinTable[t]);
      const rhoIdx = rho + rhoOffset;
      if (rhoIdx >= 0 && rhoIdx < numRho) {
        accumulator[rhoIdx * numTheta + t]++;
      }
    }
  }

  return { accumulator, numTheta, numRho, rhoOffset };
}

export function findQuadrilateralLines(houghResult, minAreaDimension = 100) {
  const { accumulator, numTheta, numRho, rhoOffset } = houghResult;
  const rhoNms = Math.max(10, Math.min(40, Math.floor(minAreaDimension / 10)));
  const thetaNms = 8;

  const accCopy = new Int32Array(accumulator);

  const peaks = [];
  for (let i = 0; i < 6; i++) {
    let bestVal = 0, bestR = 0, bestT = 0;
    for (let r = 0; r < numRho; r++) {
      for (let t = 0; t < numTheta; t++) {
        if (accCopy[r * numTheta + t] > bestVal) {
          bestVal = accCopy[r * numTheta + t];
          bestR = r;
          bestT = t;
        }
      }
    }
    if (bestVal === 0) break;

    peaks.push({
      rho: bestR - rhoOffset,
      thetaDeg: bestT,
      theta: bestT * Math.PI / numTheta,
      votes: bestVal,
    });

    for (let dr = -rhoNms; dr <= rhoNms; dr++) {
      for (let dt = -thetaNms; dt <= thetaNms; dt++) {
        const r = bestR + dr;
        let t = bestT + dt;
        if (r < 0 || r >= numRho) continue;
        if (t < 0) t += numTheta;
        if (t >= numTheta) t -= numTheta;
        accCopy[r * numTheta + t] = 0;
      }
    }
  }

  console.log(`[Hough-lines] found ${peaks.length} peaks:`,
    peaks.map(p => `(ρ=${p.rho}, θ=${p.thetaDeg}°, v=${p.votes})`).join(', '));

  if (peaks.length < 4) return null;

  const top4 = peaks.slice(0, 4);

  function angleDist(a, b) {
    const d = Math.abs(a - b);
    return Math.min(d, 180 - d);
  }

  const pairings = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ];

  let bestPairing = null, bestScore = Infinity;
  for (const [pairA, pairB] of pairings) {
    const scoreA = angleDist(top4[pairA[0]].thetaDeg, top4[pairA[1]].thetaDeg);
    const scoreB = angleDist(top4[pairB[0]].thetaDeg, top4[pairB[1]].thetaDeg);
    const score = scoreA + scoreB;
    if (score < bestScore) {
      bestScore = score;
      bestPairing = [pairA, pairB];
    }
  }

  const pair1 = [top4[bestPairing[0][0]], top4[bestPairing[0][1]]];
  const pair2 = [top4[bestPairing[1][0]], top4[bestPairing[1][1]]];

  const pairAngle1 = angleDist(pair1[0].thetaDeg, pair1[1].thetaDeg);
  const pairAngle2 = angleDist(pair2[0].thetaDeg, pair2[1].thetaDeg);
  console.log(`[Hough-lines] pairing: pair1 Δθ=${pairAngle1}°, pair2 Δθ=${pairAngle2}°`);

  if (pairAngle1 > 20 || pairAngle2 > 20) {
    console.log('[Hough-lines] FAIL: pairs not parallel enough');
    return null;
  }

  return [pair1, pair2];
}

export function intersectHoughLines(line1, line2) {
  const sinDiff = Math.sin(line2.theta - line1.theta);
  if (Math.abs(sinDiff) < 1e-10) return null;

  const x = (line1.rho * Math.sin(line2.theta) - line2.rho * Math.sin(line1.theta)) / sinDiff;
  const y = (line2.rho * Math.cos(line1.theta) - line1.rho * Math.cos(line2.theta)) / sinDiff;

  return { x, y };
}

export function orderQuadVertices(points) {
  const sorted = [...points].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

export function detectQuadrilateralVertices(boundaryPixels, imageWidth, imageHeight, pixelData = null, alphaThreshold = 128) {
  console.log(`[Hough] boundaryPixels: ${boundaryPixels.length}, image: ${imageWidth}x${imageHeight}`);
  if (boundaryPixels.length < 50) {
    console.log('[Hough] FAIL: too few boundary pixels (<50)');
    return null;
  }

  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const p of boundaryPixels) {
    if (p.x < bMinX) bMinX = p.x;
    if (p.y < bMinY) bMinY = p.y;
    if (p.x > bMaxX) bMaxX = p.x;
    if (p.y > bMaxY) bMaxY = p.y;
  }
  const minDim = Math.min(bMaxX - bMinX, bMaxY - bMinY);
  console.log(`[Hough] bounds: (${bMinX},${bMinY})-(${bMaxX},${bMaxY}), minDim: ${minDim}`);

  let pixelsForHough = boundaryPixels;
  const MAX_HOUGH_PIXELS = 5000;
  if (boundaryPixels.length > MAX_HOUGH_PIXELS) {
    const step = Math.ceil(boundaryPixels.length / MAX_HOUGH_PIXELS);
    pixelsForHough = boundaryPixels.filter((_, i) => i % step === 0);
    console.log(`[Hough] subsampled to ${pixelsForHough.length} pixels`);
  }

  const houghResult = houghTransform(pixelsForHough, imageWidth, imageHeight);
  console.log(`[Hough] accumulator: ${houghResult.numRho}x${houghResult.numTheta}`);

  const linePairs = findQuadrilateralLines(houghResult, minDim);

  if (!linePairs) {
    console.log('[Hough] FAIL: findQuadrilateralLines returned null');
    return null;
  }

  const [pair1, pair2] = linePairs;
  const allLines = [...pair1, ...pair2];
  const maxVotes = allLines[0].votes;
  const minVotesAbsolute = pixelsForHough.length * 0.02;
  const minVotesRelative = maxVotes * 0.25;
  const minVotes = Math.max(minVotesAbsolute, minVotesRelative);
  console.log(`[Hough] 4 lines found. votes: [${allLines.map(l => l.votes).join(', ')}], minRequired: ${minVotes.toFixed(1)}`);
  console.log(`[Hough] lines: ${allLines.map(l => `(rho=${l.rho.toFixed(1)}, θ=${l.thetaDeg}°)`).join(', ')}`);

  if (allLines.some(line => line.votes < minVotes)) {
    console.log('[Hough] FAIL: some lines have too few votes');
    return null;
  }

  // Boundary pixels are the transparent pixels adjacent to non-transparent content,
  // so Hough lines run along the transparent side. Expanding each line outward by
  // ~1.5 px ensures all non-transparent pixels fall inside the resulting quadrilateral.
  const EXPAND_PX = 1.5;
  const cx = (bMinX + bMaxX) / 2;
  const cy = (bMinY + bMaxY) / 2;

  for (const line of allLines) {
    const rhoCenter = cx * Math.cos(line.theta) + cy * Math.sin(line.theta);
    const sign = line.rho >= rhoCenter ? 1 : -1;
    line.rho += sign * EXPAND_PX;
  }
  console.log(`[Hough] lines expanded outward by ${EXPAND_PX}px (center: ${cx.toFixed(1)},${cy.toFixed(1)})`);

  const vertices = [];
  for (const l1 of pair1) {
    for (const l2 of pair2) {
      const pt = intersectHoughLines(l1, l2);
      if (!pt) {
        console.log(`[Hough] FAIL: parallel lines cannot intersect`);
        return null;
      }
      vertices.push(pt);
    }
  }

  if (vertices.length !== 4) return null;

  const margin = Math.max(imageWidth, imageHeight) * 0.1;
  for (const v of vertices) {
    if (v.x < -margin || v.x > imageWidth + margin ||
      v.y < -margin || v.y > imageHeight + margin) {
      console.log(`[Hough] FAIL: vertex out of bounds: (${v.x.toFixed(1)}, ${v.y.toFixed(1)}), margin: ${margin}`);
      return null;
    }
  }

  const ordered = orderQuadVertices(vertices);
  console.log(`[Hough] SUCCESS: vertices = ${ordered.map(v => `(${v.x.toFixed(1)},${v.y.toFixed(1)})`).join(', ')}`);
  return {
    vertices: ordered,
    houghLines: [pair1, pair2],
  };
}
