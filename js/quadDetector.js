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

  console.error(`[Hough-lines] found ${peaks.length} peaks:`,
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
  console.error(`[Hough-lines] pairing: pair1 Δθ=${pairAngle1}°, pair2 Δθ=${pairAngle2}°`);

  if (pairAngle1 > 20 || pairAngle2 > 20) {
    console.error('[Hough-lines] FAIL: pairs not parallel enough');
    return null;
  }

  return [pair1, pair2];
}

// Returns the signed distance from point p to a Hough line (rho, theta).
// Positive = same side as the normal vector; negative = opposite side.
function signedDistToLine(p, line) {
  return p.x * Math.cos(line.theta) + p.y * Math.sin(line.theta) - line.rho;
}

// Constructs a Hough line (rho, theta, thetaDeg) passing through two points.
// Returns null when the two points are coincident.
function lineFromTwoPoints(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const m = Math.sqrt(dx * dx + dy * dy);
  if (m < 1e-10) return null;

  // Normal direction is (-dy, dx) / m
  let cosT = -dy / m;
  let sinT = dx / m;
  let theta = Math.atan2(sinT, cosT);
  // Normalise to [0, π)
  if (theta < 0) theta += Math.PI;
  if (theta >= Math.PI) theta -= Math.PI;
  cosT = Math.cos(theta);
  sinT = Math.sin(theta);
  const rho = p1.x * cosT + p1.y * sinT;
  const thetaDeg = Math.round(theta * 180 / Math.PI);
  return { rho, theta, thetaDeg };
}

/**
 * Refines the four Hough lines by detecting boundary pixels that fall outside
 * the current quadrilateral and tilting each offending edge so it passes through
 * the farthest outlier while being anchored at the opposite endpoint.
 *
 * Mutates pair1 and pair2 in-place; also returns the final ordered vertices.
 *
 * Vertex matrix layout:
 *   vm[i][j] = pair1[i] ∩ pair2[j]
 *
 *   Edge pair1[0]: endpoints vm[0][0], vm[0][1]
 *   Edge pair1[1]: endpoints vm[1][0], vm[1][1]
 *   Edge pair2[0]: endpoints vm[0][0], vm[1][0]
 *   Edge pair2[1]: endpoints vm[0][1], vm[1][1]
 */
export function refineQuadByOutliers(pair1, pair2, boundaryPixels) {
  function computeVertMatrix() {
    return [
      [intersectHoughLines(pair1[0], pair2[0]), intersectHoughLines(pair1[0], pair2[1])],
      [intersectHoughLines(pair1[1], pair2[0]), intersectHoughLines(pair1[1], pair2[1])],
    ];
  }

  let vm = computeVertMatrix();

  const edgeDefs = [
    { label: 'pair1[0]', pairIdx: 0, lineIdx: 0, endpts: (m) => [m[0][0], m[0][1]] },
    { label: 'pair1[1]', pairIdx: 0, lineIdx: 1, endpts: (m) => [m[1][0], m[1][1]] },
    { label: 'pair2[0]', pairIdx: 1, lineIdx: 0, endpts: (m) => [m[0][0], m[1][0]] },
    { label: 'pair2[1]', pairIdx: 1, lineIdx: 1, endpts: (m) => [m[0][1], m[1][1]] },
  ];

  const pairs = [pair1, pair2];

  for (const edge of edgeDefs) {
    const line = pairs[edge.pairIdx][edge.lineIdx];

    // Determine which side of the line is "inside" the quad using the centroid
    const allV = [vm[0][0], vm[0][1], vm[1][0], vm[1][1]];
    const cx = (allV[0].x + allV[1].x + allV[2].x + allV[3].x) / 4;
    const cy = (allV[0].y + allV[1].y + allV[2].y + allV[3].y) / 4;
    const insideSign = Math.sign(signedDistToLine({ x: cx, y: cy }, line));

    // Find boundary pixels that lie on the outside of this edge
    const outliers = [];
    for (const p of boundaryPixels) {
      if (signedDistToLine(p, line) * insideSign < 0) outliers.push(p);
    }

    console.error(`[Refine] Edge ${edge.label}: ${outliers.length} boundary pixels outside`);

    if (outliers.length === 0) continue;

    // Find the farthest outlier from the edge
    let maxDist = 0;
    let pMax = null;
    for (const p of outliers) {
      const d = Math.abs(signedDistToLine(p, line));
      if (d > maxDist) { maxDist = d; pMax = p; }
    }

    // Get the two endpoint vertices of this edge from the current vertex matrix
    const [V1, V2] = edge.endpts(vm);
    if (!V1 || !V2) continue;

    // The vertex closer to pMax is the "problem" vertex; anchor on the farther one
    const d1 = Math.hypot(V1.x - pMax.x, V1.y - pMax.y);
    const d2 = Math.hypot(V2.x - pMax.x, V2.y - pMax.y);
    const vFar = d1 > d2 ? V1 : V2;

    // Build new Hough line through vFar and pMax
    const newLine = lineFromTwoPoints(vFar, pMax);
    if (!newLine) continue;

    // Safety check: reject if the new line's angle deviates too much
    const angleDiff = Math.abs(newLine.thetaDeg - line.thetaDeg);
    const clampedDiff = Math.min(angleDiff, 180 - angleDiff);
    if (clampedDiff > 15) {
      console.error(`[Refine] Edge ${edge.label}: angle deviation ${clampedDiff}° too large, skipping`);
      continue;
    }

    newLine.votes = line.votes;
    pairs[edge.pairIdx][edge.lineIdx] = newLine;

    // Recompute all vertices with the updated line
    vm = computeVertMatrix();
    console.error(
      `[Refine] Edge ${edge.label}: adjusted — farthest outlier at (${pMax.x},${pMax.y}), dist=${maxDist.toFixed(1)}px`
    );
  }

  const finalVerts = orderQuadVertices([vm[0][0], vm[0][1], vm[1][0], vm[1][1]]);
  console.error(
    `[Refine] Final vertices = ${finalVerts.map(v => `(${v.x.toFixed(1)},${v.y.toFixed(1)})`).join(', ')}`
  );
  return finalVerts;
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
  console.error(`[Hough] boundaryPixels: ${boundaryPixels.length}, image: ${imageWidth}x${imageHeight}`);
  if (boundaryPixels.length < 50) {
    console.error('[Hough] FAIL: too few boundary pixels (<50)');
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
  console.error(`[Hough] bounds: (${bMinX},${bMinY})-(${bMaxX},${bMaxY}), minDim: ${minDim}`);

  let pixelsForHough = boundaryPixels;
  const MAX_HOUGH_PIXELS = 5000;
  if (boundaryPixels.length > MAX_HOUGH_PIXELS) {
    const step = Math.ceil(boundaryPixels.length / MAX_HOUGH_PIXELS);
    pixelsForHough = boundaryPixels.filter((_, i) => i % step === 0);
    console.error(`[Hough] subsampled to ${pixelsForHough.length} pixels`);
  }

  const houghResult = houghTransform(pixelsForHough, imageWidth, imageHeight);
  console.error(`[Hough] accumulator: ${houghResult.numRho}x${houghResult.numTheta}`);

  const linePairs = findQuadrilateralLines(houghResult, minDim);

  if (!linePairs) {
    console.error('[Hough] FAIL: findQuadrilateralLines returned null');
    return null;
  }

  const [pair1, pair2] = linePairs;
  const allLines = [...pair1, ...pair2];
  const minVotesAbsolute = pixelsForHough.length * 0.02;

  // Check each pair independently: the weaker line in a pair must reach at least
  // PAIR_RATIO of the stronger line in the same pair. This avoids rejecting a valid
  // but lower-contrast side just because the opposite side is much stronger.
  const PAIR_RATIO = 0.30;
  function pairMinVotes(pair) {
    const pairMax = Math.max(pair[0].votes, pair[1].votes);
    return Math.max(minVotesAbsolute, pairMax * PAIR_RATIO);
  }
  const minVotes1 = pairMinVotes(pair1);
  const minVotes2 = pairMinVotes(pair2);

  console.error(`[Hough] 4 lines found. votes: [${allLines.map(l => l.votes).join(', ')}], minRequired: pair1=${minVotes1.toFixed(1)}, pair2=${minVotes2.toFixed(1)}`);
  console.error(`[Hough] lines: ${allLines.map(l => `(rho=${l.rho.toFixed(1)}, θ=${l.thetaDeg}°)`).join(', ')}`);

  if (pair1.some(line => line.votes < minVotes1) || pair2.some(line => line.votes < minVotes2)) {
    console.error('[Hough] FAIL: some lines have too few votes');
    return null;
  }

  // Compute initial 4 vertices from Hough line intersections.
  // Order in the array: [pair1[0]∩pair2[0], pair1[0]∩pair2[1], pair1[1]∩pair2[0], pair1[1]∩pair2[1]]
  const vertices = [];
  for (const l1 of pair1) {
    for (const l2 of pair2) {
      const pt = intersectHoughLines(l1, l2);
      if (!pt) {
        console.error(`[Hough] FAIL: parallel lines cannot intersect`);
        return null;
      }
      vertices.push(pt);
    }
  }

  if (vertices.length !== 4) return null;

  // Expand each vertex 2px outward from the quad centroid (x±2, y±2).
  // This replaces the previous rho-based expansion and gives refineQuadByOutliers
  // a slightly enlarged starting quad so minor boundary pixels are already covered.
  const PRE_EXPAND = 2;
  const vCx = (vertices[0].x + vertices[1].x + vertices[2].x + vertices[3].x) / 4;
  const vCy = (vertices[0].y + vertices[1].y + vertices[2].y + vertices[3].y) / 4;
  const preExpanded = vertices.map(v => ({
    x: v.x + (v.x >= vCx ? PRE_EXPAND : -PRE_EXPAND),
    y: v.y + (v.y >= vCy ? PRE_EXPAND : -PRE_EXPAND),
  }));
  console.error(`[Hough] Pre-expand +${PRE_EXPAND}px: centroid=(${vCx.toFixed(1)},${vCy.toFixed(1)})`);

  // Update the Hough lines to be consistent with the expanded vertex positions so that
  // refineQuadByOutliers starts from the already-enlarged quad boundary.
  // Vertex index mapping: [0]=v00, [1]=v01, [2]=v10, [3]=v11  (v_ij = pair1[i] ∩ pair2[j])
  const updateLine = (orig, p, q) => {
    const nl = lineFromTwoPoints(p, q);
    if (nl) nl.votes = orig.votes;
    return nl || orig;
  };
  pair1[0] = updateLine(pair1[0], preExpanded[0], preExpanded[1]); // L0: v00–v01
  pair1[1] = updateLine(pair1[1], preExpanded[2], preExpanded[3]); // L1: v10–v11
  pair2[0] = updateLine(pair2[0], preExpanded[0], preExpanded[2]); // L2: v00–v10
  pair2[1] = updateLine(pair2[1], preExpanded[1], preExpanded[3]); // L3: v01–v11

  const margin = Math.max(imageWidth, imageHeight) * 0.1;
  for (const v of preExpanded) {
    if (v.x < -margin || v.x > imageWidth + margin ||
      v.y < -margin || v.y > imageHeight + margin) {
      console.error(`[Hough] FAIL: vertex out of bounds after pre-expand: (${v.x.toFixed(1)}, ${v.y.toFixed(1)})`);
      return null;
    }
  }

  const ordered = orderQuadVertices(preExpanded);
  console.error(`[Hough] SUCCESS (pre-refine, +${PRE_EXPAND}px): vertices = ${ordered.map(v => `(${v.x.toFixed(1)},${v.y.toFixed(1)})`).join(', ')}`);

  // Refine each edge outward to cover any boundary pixels that fall outside the expanded quad
  const refinedVertices = refineQuadByOutliers(pair1, pair2, boundaryPixels);

  // Expand refined vertices a further 3px outward (x±3, y±3) as final safety margin
  const POST_EXPAND = 2;
  const rCx = (refinedVertices[0].x + refinedVertices[1].x + refinedVertices[2].x + refinedVertices[3].x) / 4;
  const rCy = (refinedVertices[0].y + refinedVertices[1].y + refinedVertices[2].y + refinedVertices[3].y) / 4;
  const finalVertices = refinedVertices.map(v => ({
    x: v.x + (v.x >= rCx ? POST_EXPAND : -POST_EXPAND),
    y: v.y + (v.y >= rCy ? POST_EXPAND : -POST_EXPAND),
  }));
  console.error(`[Hough] Final vertices (+${POST_EXPAND}px post-expand) = ${finalVertices.map(v => `(${v.x.toFixed(1)},${v.y.toFixed(1)})`).join(', ')}`);

  return {
    vertices: finalVertices,
    houghLines: [pair1, pair2],
  };
}
