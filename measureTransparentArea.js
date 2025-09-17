// Constants
const ALPHA_THRESHOLD = 192; // Alpha value threshold to determine transparency
const IMAGE_BORDER_OFFSET = 10; // Px offset from image edges to start transparency detection
const CORNER_DETECTION_RADIUS = 15; // Px radius to detect mouse hover over a corner
const EDGE_DETECTION_TOLERANCE = 10; // Px distance to detect mouse hover over an edge
const CHECKERBOARD_TILE_SIZE = 2; // Px size for the canvas background checkerboard tiles
const MIN_AREA_PIXELS = 100; // Minimum pixel count for a transparent area

// Utility functions
const toFloat = (value, precision = 6) => parseFloat(value.toFixed(precision));

const rotatePoint = (point, center, angle) => {
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

const scalePoint = (point, center, scale) => {
  return {
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale
  };
};

const pointToLineDistance = (point, line) => {
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

class ImageProcessorApp {
  constructor() {
    this.elements = {
      imageInput: document.getElementById('imageInput'),
      productWidthInput: document.getElementById('productWidth'),
      productHeightInput: document.getElementById('productHeight'),
      bleedInput: document.getElementById('bleed'),
      alignmentControl: document.getElementById('alignmentControl'),
      horizontalGuidesInput: document.getElementById('horizontalGuidesInput'),
      verticalGuidesInput: document.getElementById('verticalGuidesInput'),
      analyzeButton: document.getElementById('analyzeButton'),
      confirmButton: document.getElementById('confirmButton'),
      poInfo: document.getElementById('poInfo'),
      templateInfo: document.getElementById('templateInfo'),
      positionsInfo: document.getElementById('positionsInfo'),
      calculateMarginsButton: document.getElementById('calculateMarginsButton'),
      resultCanvas: document.getElementById('resultCanvas'),
      interactiveCanvas: document.getElementById('interactiveCanvas'),
      transformControls: document.getElementById('transformControls'),
      rotationControl: document.getElementById('rotationControl'),
      scaleControl: document.getElementById('scaleControl'),
      rotationValue: document.getElementById('rotationValue'),
      scaleValue: document.getElementById('scaleValue'),
      canvasScaleControl: document.getElementById('canvasScaleControl'),
    };
    this.interactiveCtx = this.elements.interactiveCanvas.getContext('2d');
    this.selectedImage = null;

    this.state = {
      cornerSets: [], // Array of corner arrays for each area
      isDragging: false,
      selectedCornerInfo: null, // { areaIndex, cornerIndex }
      finalRects: [],
      transparentRects: [],
      isTransparentAreaModified: false,
      selectedEdgeInfo: null, // { areaIndex, edgeType }
      originalMousePos: null,
      canvasOffset: { x: 0, y: 0 },
    };

    this.transform = {
      rotation: 0,
      scale: 1,
      originalRects: [], // Store original rects for each area
    };
  }

  init() {
    this._addEventListeners();
  }

  _addEventListeners() {
    this.elements.imageInput.addEventListener('change', (e) => this._handleImageSelection(e));

    this.elements.interactiveCanvas.addEventListener('mousedown', (e) => this._handleMouseDown(e));
    this.elements.interactiveCanvas.addEventListener('mousemove', (e) => this._handleMouseMove(e));
    this.elements.interactiveCanvas.addEventListener('mouseup', () => this._resetMouseState());
    this.elements.interactiveCanvas.addEventListener('mouseleave', () => this._resetMouseState());

    this.elements.analyzeButton.addEventListener('click', () => this._analyzeImage());
    this.elements.confirmButton.addEventListener('click', () => this._confirmSelection());
    this.elements.calculateMarginsButton.addEventListener('click', () => this._calculateAndDisplayMargins());

    this.elements.rotationControl.addEventListener('input', (e) => {
      const slider = e.target;
      this.transform.rotation = parseFloat(slider.value);
      const output = this.elements.rotationValue;
      output.textContent = `${this.transform.rotation}°`;
      this._updateRectWithTransforms();
      this._updateSliderValuePosition(slider, output);
    });

    this.elements.scaleControl.addEventListener('input', (e) => {
      const slider = e.target;
      this.transform.scale = parseFloat(slider.value) / 100;
      const output = this.elements.scaleValue;
      output.textContent = this.transform.scale.toFixed(2);
      this._updateRectWithTransforms();
      this._updateSliderValuePosition(slider, output);
    });

    this.elements.horizontalGuidesInput.addEventListener('input', () => this._drawCorners());
    this.elements.verticalGuidesInput.addEventListener('input', () => this._drawCorners());

    this.elements.canvasScaleControl.addEventListener('input', (e) => this._handleCanvasScaleChange(e));

    document.querySelectorAll('.copy-button').forEach(button => {
      button.addEventListener('click', async () => {
        const targetId = button.getAttribute('data-target');
        const targetElement = document.getElementById(targetId);
        const textToCopy = targetElement.querySelector('.info-content').textContent.trim();

        try {
          await navigator.clipboard.writeText(textToCopy);
          const originalColor = button.style.color;
          button.style.color = '#4CAF50';
          setTimeout(() => { button.style.color = originalColor; }, 1000);
        } catch (err) {
          console.error('Copy failed!', err);
          alert('Copy failed!');
        }
      });
    });
  }

  _handleCanvasScaleChange(e) {
    if (this.selectedImage) {
      this._setupCanvases();
      this._drawResult(this.state.finalRects.length > 0);
      if (this.state.finalRects.length > 0) {
        this._drawCorners();
      }
    }
  }

  _resetAppState() {
    this.state.transparentRects = [];
    this.state.finalRects = [];
    this.state.isTransparentAreaModified = false;
    this.state.cornerSets = [];
    this.elements.confirmButton.style.visibility = 'hidden';
    this.elements.transformControls.style.display = 'none';
    this.elements.poInfo.querySelector('.info-content').textContent = '';
    this.elements.templateInfo.querySelector('.info-content').textContent = '';
    this.elements.positionsInfo.querySelector('.info-content').textContent = '';
    this.elements.positionsInfo.style.display = 'none';
    this.elements.calculateMarginsButton.style.visibility = 'hidden';

    this.transform.rotation = 0;
    this.transform.scale = 1;
    this.transform.originalRects = [];

    this.elements.rotationControl.value = 0;
    this.elements.scaleControl.value = 100;
    this.elements.rotationValue.textContent = '0°';
    this.elements.scaleValue.textContent = '1.0';
    this.elements.canvasScaleControl.value = 1;

    if (this.elements.rotationValue.style) {
      this.elements.rotationValue.style.left = '50%';
    }
    if (this.elements.scaleValue.style) {
      this.elements.scaleValue.style.left = '50%';
    }

    if (this.interactiveCtx) {
      this.interactiveCtx.clearRect(0, 0, this.elements.interactiveCanvas.width, this.elements.interactiveCanvas.height);
    }
    const resultCtx = this.elements.resultCanvas.getContext('2d');
    if (resultCtx) {
      resultCtx.clearRect(0, 0, this.elements.resultCanvas.width, this.elements.resultCanvas.height);
    }
  }

  async _handleImageSelection(e) {
    const file = e.target.files[0];
    if (file) {
      try {
        this.selectedImage = await this._loadImage(file);
        this._resetAppState();
      } catch (error) {
        console.error('Image loading failed:', error);
        alert('Failed to load image.');
      }
    }
  }

  _loadImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  _analyzeImage() {
    if (!this.selectedImage) {
      alert('Please choose an image first!');
      return;
    }

    // Reset state from confirmation step
    this.state.finalRects = [];
    this.state.cornerSets = [];
    this.interactiveCtx.clearRect(0, 0, this.elements.interactiveCanvas.width, this.elements.interactiveCanvas.height);
    this.elements.transformControls.style.display = 'none';
    this.elements.calculateMarginsButton.style.visibility = 'hidden';

    this.state.transparentRects = this._detectTransparentArea(this.selectedImage);
    this._setupCanvases();
    this._drawResult();
    this.elements.confirmButton.style.visibility = 'visible';
  }

  _setupCanvases() {
    const img = this.selectedImage;
    const canvasScaleFactor = parseFloat(this.elements.canvasScaleControl.value);
    const canvasWidth = img.width * canvasScaleFactor;
    const canvasHeight = img.height * canvasScaleFactor;
    this.state.canvasOffset.x = (canvasWidth - img.width) / 2;
    this.state.canvasOffset.y = (canvasHeight - img.height) / 2;

    const container = document.querySelector('.canvas-container');
    const scale = this._calculateCanvasScale(canvasWidth, canvasHeight, container.clientWidth, container.clientHeight);

    [this.elements.resultCanvas, this.elements.interactiveCanvas].forEach(canvas => {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      canvas.style.width = `${canvasWidth * scale}px`;
      canvas.style.height = `${canvasHeight * scale}px`;
    });
  }

  _calculateCanvasScale(imageWidth, imageHeight, containerWidth, containerHeight) {
    const scaleX = containerWidth / imageWidth;
    const scaleY = containerHeight / imageHeight;
    return Math.min(scaleX, scaleY, 1);
  }

  _detectTransparentArea(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const visited = new Array(canvas.width * canvas.height).fill(false);
    const areas = [];

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

        if (data[(y * canvas.width + x) * 4 + 3] >= ALPHA_THRESHOLD) {
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
        if (!visited[index] && data[index * 4 + 3] < ALPHA_THRESHOLD) {
          const area = floodFill(x, y);
          if (area.pixels > MIN_AREA_PIXELS) {
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

    areas.sort((a, b) => b.pixels - a.pixels);

    return areas.map(area => ({
      x: area.minX - 1,
      y: area.minY - 1,
      width: area.maxX - area.minX + 2,
      height: area.maxY - area.minY + 2,
    }));
  }

  _confirmSelection() {
    if (this.state.transparentRects.length === 0) return;

    const isMultiArea = this.state.transparentRects.length > 1;

    if (isMultiArea) {
      this.state.finalRects = this.state.transparentRects.map(rect => ({ ...rect }));
      this.transform.originalRects = this.state.transparentRects.map(rect => ({ ...rect }));
      this.elements.transformControls.style.display = 'none';
    } else {
      const productWidth = parseFloat(this.elements.productWidthInput.value) || 1;
      const productHeight = parseFloat(this.elements.productHeightInput.value) || 1;
      const transparentRect = this.state.transparentRects[0];
      const aspectRatio = this.elements.productWidthInput.value && this.elements.productHeightInput.value
        ? productWidth / productHeight
        : transparentRect.width / transparentRect.height;

      const bleed = parseFloat(this.elements.bleedInput.value) || 0;
      const bleedRatio = bleed / productWidth;
      const alignment = this.elements.alignmentControl?.value || 'center';

      this.state.finalRects = [this._calculateAspectRatioRect(transparentRect, aspectRatio, bleedRatio, alignment)];
      this.transform.originalRects = [{ ...this.state.finalRects[0] }];
      this.elements.transformControls.style.display = 'block';

      // Update slider value positions after they become visible
      this._updateSliderValuePosition(this.elements.rotationControl, this.elements.rotationValue);
      this._updateSliderValuePosition(this.elements.scaleControl, this.elements.scaleValue);
    }

    this._initializeCorners();
    this._updateInfoPanels();
    this._drawResult(true);
    this._drawCorners();
    this.elements.calculateMarginsButton.style.visibility = 'visible';
  }

  _initializeCorners() {
    this.state.cornerSets = this.state.finalRects.map(rect => [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ]);
  }

  _calculateAspectRatioRect(transparentArea, aspectRatio, bleedRatio, alignment = 'center') {
    const { x, y, width, height } = transparentArea;
    let newWidth, newHeight;
    if (width / height > aspectRatio) {
      newWidth = width;
      newHeight = newWidth / aspectRatio;
    } else {
      newHeight = height;
      newWidth = newHeight * aspectRatio;
    }

    const bleeding = newWidth * bleedRatio;
    const finalWidth = newWidth + 2 * bleeding;
    const finalHeight = newHeight + 2 * bleeding;

    let finalX, finalY;

    // Horizontal alignment
    switch (alignment) {
      case 'left':
        finalX = x - bleeding;
        break;
      case 'right':
        finalX = x + width - finalWidth + bleeding;
        break;
      case 'top':
      case 'bottom':
      case 'center':
      default:
        finalX = x + (width - finalWidth) / 2;
        break;
    }

    // Vertical alignment
    switch (alignment) {
      case 'top':
        finalY = y - bleeding;
        break;
      case 'bottom':
        finalY = y + height - finalHeight + bleeding;
        break;
      case 'left':
      case 'right':
      case 'center':
      default:
        finalY = y + (height - finalHeight) / 2;
        break;
    }

    return {
      x: finalX,
      y: finalY,
      width: finalWidth,
      height: finalHeight,
    };
  }

  _drawResult(drawFinal = false) {
    const img = this.selectedImage;
    const canvas = this.elements.resultCanvas;
    const ctx = canvas.getContext('2d');
    const offsetX = this.state.canvasOffset.x;
    const offsetY = this.state.canvasOffset.y;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw checkerboard background
    for (let y = 0; y < canvas.height; y += CHECKERBOARD_TILE_SIZE) {
      for (let x = 0; x < canvas.width; x += CHECKERBOARD_TILE_SIZE) {
        ctx.fillStyle = ((x / CHECKERBOARD_TILE_SIZE) + (y / CHECKERBOARD_TILE_SIZE)) % 2 === 0 ? '#ffffff' : '#e0e0e0';
        ctx.fillRect(x, y, CHECKERBOARD_TILE_SIZE, CHECKERBOARD_TILE_SIZE);
      }
    }

    // Draw original image
    ctx.drawImage(img, offsetX, offsetY);

    // Draw transparent area rectangles (green)
    this.state.transparentRects.forEach(transparentArea => {
      ctx.strokeStyle = 'green';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        transparentArea.x + offsetX,
        transparentArea.y + offsetY,
        transparentArea.width,
        transparentArea.height
      );
    });

    // Draw final red rectangles
    if (drawFinal) {
      this.state.finalRects.forEach(finalRect => {
        ctx.strokeStyle = 'blue';
        ctx.lineWidth = 1;
        ctx.strokeRect(
          finalRect.x + offsetX,
          finalRect.y + offsetY,
          finalRect.width,
          finalRect.height
        );
      });
    }
  }

  _drawCorners() {
    if (this.state.cornerSets.length === 0) return;

    const ctx = this.interactiveCtx;
    const offsetX = this.state.canvasOffset.x;
    const offsetY = this.state.canvasOffset.y;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.lineWidth = 2;

    this.state.cornerSets.forEach(corners => {
      // Draw connecting lines
      ctx.strokeStyle = 'magenta';
      ctx.beginPath();
      ctx.moveTo(corners[0].x + offsetX, corners[0].y + offsetY);
      for (let i = 1; i <= 4; i++) {
        ctx.lineTo(corners[i % 4].x + offsetX, corners[i % 4].y + offsetY);
      }
      ctx.stroke();

      // Draw Guide Lines for this set of corners
      this._drawGuideLinesForCorners(ctx, offsetX, offsetY, corners);

      // Draw vertices
      corners.forEach(corner => {
        ctx.beginPath();
        ctx.arc(corner.x + offsetX, corner.y + offsetY, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#00FF00';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    });
  }

  _drawGuideLinesForCorners(ctx, offsetX, offsetY, corners) {
    const hValues = this._parseGuideValues(this.elements.horizontalGuidesInput.value);
    const vValues = this._parseGuideValues(this.elements.verticalGuidesInput.value);

    const [c0, c1, c2, c3] = corners; // tl, tr, br, bl

    const originalStrokeStyle = ctx.strokeStyle;
    const originalLineWidth = ctx.lineWidth;
    const originalLineDash = ctx.getLineDash();

    ctx.strokeStyle = 'rgba(255, 0, 255, 0.5)'; // Semi-transparent magenta
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]); // Dashed lines for guides

    // Draw horizontal guides (from V-values)
    vValues.forEach(p => {
      const p1 = { x: c0.x + p * (c3.x - c0.x), y: c0.y + p * (c3.y - c0.y) };
      const p2 = { x: c1.x + p * (c2.x - c1.x), y: c1.y + p * (c2.y - c1.y) };
      ctx.beginPath();
      ctx.moveTo(p1.x + offsetX, p1.y + offsetY);
      ctx.lineTo(p2.x + offsetX, p2.y + offsetY);
      ctx.stroke();
    });

    // Draw vertical guides (from H-values)
    hValues.forEach(p => {
      const p1 = { x: c0.x + p * (c1.x - c0.x), y: c0.y + p * (c1.y - c0.y) };
      const p2 = { x: c3.x + p * (c2.x - c3.x), y: c3.y + p * (c2.y - c3.y) };
      ctx.beginPath();
      ctx.moveTo(p1.x + offsetX, p1.y + offsetY);
      ctx.lineTo(p2.x + offsetX, p2.y + offsetY);
      ctx.stroke();
    });

    ctx.strokeStyle = originalStrokeStyle;
    ctx.lineWidth = originalLineWidth;
    ctx.setLineDash(originalLineDash); // Reset line dash
  }

  _drawGuideLines(ctx, offsetX, offsetY) {
    // This method is now a wrapper that calls the new method for each corner set.
    // It's kept for potential partial refactors, but the main logic is moved.
    // The main call from _drawCorners is now directly to _drawGuideLinesForCorners.
    this.state.cornerSets.forEach(corners => {
      this._drawGuideLinesForCorners(ctx, offsetX, offsetY, corners);
    });
  }

  _parseGuideValues(inputValue) {
    if (!inputValue) {
      return [0.5];
    }

    const values = inputValue
      .split(',')
      .map(v => parseFloat(v.trim()))
      .filter(v => !isNaN(v) && v >= 0 && v <= 1);

    const guideSet = new Set(values);
    guideSet.add(0.5); // Ensure center line is always present

    return Array.from(guideSet);
  }

  _getMousePos(evt) {
    const canvas = this.elements.interactiveCanvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (evt.clientX - rect.left) * scaleX;
    const canvasY = (evt.clientY - rect.top) * scaleY;
    return {
      canvas: { x: canvasX, y: canvasY },
      image: {
        x: canvasX - this.state.canvasOffset.x,
        y: canvasY - this.state.canvasOffset.y
      }
    };
  }

  _findClosestCorner(mousePos) {
    for (let i = 0; i < this.state.cornerSets.length; i++) {
      const corners = this.state.cornerSets[i];
      for (let j = 0; j < corners.length; j++) {
        const corner = corners[j];
        const distance = Math.hypot(corner.x - mousePos.x, corner.y - mousePos.y);
        if (distance < CORNER_DETECTION_RADIUS) {
          return { areaIndex: i, cornerIndex: j };
        }
      }
    }
    return null;
  }

  _findClosestEdge(mousePos) {
    if (this.state.transparentRects.length === 0) return null;

    for (let i = 0; i < this.state.transparentRects.length; i++) {
      const rect = this.state.transparentRects[i];
      const { x, y, width, height } = rect;
      const edges = [
        { type: 'top', line: { x1: x, y1: y, x2: x + width, y2: y } },
        { type: 'right', line: { x1: x + width, y1: y, x2: x + width, y2: y + height } },
        { type: 'bottom', line: { x1: x, y1: y + height, x2: x + width, y2: y + height } },
        { type: 'left', line: { x1: x, y1: y, x2: x, y2: y + height } }
      ];

      for (const edge of edges) {
        if (pointToLineDistance(mousePos, edge.line) < EDGE_DETECTION_TOLERANCE) {
          return { areaIndex: i, edgeType: edge.type };
        }
      }
    }
    return null;
  }

  _handleMouseDown(e) {
    const mousePos = this._getMousePos(e).image;
    if (this.state.finalRects.length > 0) {
      this.state.selectedCornerInfo = this._findClosestCorner(mousePos);
      if (this.state.selectedCornerInfo) {
        this.state.isDragging = true;
      }
    } else if (this.state.transparentRects.length > 0) {
      this.state.selectedEdgeInfo = this._findClosestEdge(mousePos);
      if (this.state.selectedEdgeInfo) {
        this.state.isDragging = true;
        this.state.originalMousePos = mousePos;
        this.state.isTransparentAreaModified = true;
      }
    }
  }

  _handleMouseMove(e) {
    const mousePos = this._getMousePos(e).image;
    let cursorStyle = 'default';

    if (this.state.isDragging) {
      if (this.state.selectedCornerInfo) {
        const { areaIndex, cornerIndex } = this.state.selectedCornerInfo;
        this.state.cornerSets[areaIndex][cornerIndex].x = mousePos.x;
        this.state.cornerSets[areaIndex][cornerIndex].y = mousePos.y;
        this._drawCorners();
      } else if (this.state.selectedEdgeInfo) {
        this._dragTransparentRectEdge(mousePos);
      }
    } else {
      // Handle hover effects
      if (this.state.finalRects.length > 0) {
        if (this._findClosestCorner(mousePos)) cursorStyle = 'pointer';
      } else if (this.state.transparentRects.length > 0) {
        if (this._findClosestEdge(mousePos)) cursorStyle = 'move';
      }
    }
    this.elements.interactiveCanvas.style.cursor = cursorStyle;
  }

  _dragTransparentRectEdge(mousePos) {
    const dx = mousePos.x - this.state.originalMousePos.x;
    const dy = mousePos.y - this.state.originalMousePos.y;
    const { areaIndex, edgeType } = this.state.selectedEdgeInfo;
    const rect = this.state.transparentRects[areaIndex];

    switch (edgeType) {
      case 'left':
        rect.width -= dx;
        rect.x += dx;
        break;
      case 'right':
        rect.width = mousePos.x - rect.x;
        break;
      case 'top':
        rect.height -= dy;
        rect.y += dy;
        break;
      case 'bottom':
        rect.height = mousePos.y - rect.y;
        break;
    }
    this.state.originalMousePos = mousePos;
    this._drawResult(false);
  }

  _resetMouseState() {
    this.state.isDragging = false;
    this.state.selectedCornerInfo = null;
    this.state.selectedEdgeInfo = null;
    this.state.originalMousePos = null;
  }

  _updateRectWithTransforms() {
    if (this.transform.originalRects.length !== 1 || !this.state.finalRects.length === 0) return;

    const originalRect = this.transform.originalRects[0];
    const center = {
      x: originalRect.x + originalRect.width / 2,
      y: originalRect.y + originalRect.height / 2
    };

    const o = originalRect;
    const originalCorners = [
      { x: o.x, y: o.y },
      { x: o.x + o.width, y: o.y },
      { x: o.x + o.width, y: o.y + o.height },
      { x: o.x, y: o.y + o.height },
    ];

    this.state.cornerSets[0] = originalCorners.map(corner => {
      const rotated = rotatePoint(corner, center, this.transform.rotation);
      return scalePoint(rotated, center, this.transform.scale);
    });

    this._drawCorners();
  }

  _updateInfoPanels() {
    if (this.state.finalRects.length === 0 || !this.selectedImage) return;
    const img = this.selectedImage;

    const poInfos = this.state.finalRects.map(rect => ({
      x: toFloat(rect.x / img.width, 4),
      y: toFloat(rect.y / img.height, 4),
      w: toFloat(rect.width / img.width, 4),
      h: toFloat(rect.height / img.height, 4)
    }));

    const templateInfos = this.state.finalRects.map(rect => ({
      width: img.width,
      height: img.height,
      left: Math.round(rect.x),
      top: Math.round(rect.y),
      right: Math.round(rect.x + rect.width),
      bottom: Math.round(rect.y + rect.height)
    }));

    this.elements.poInfo.querySelector('.info-content').textContent = JSON.stringify(poInfos, null, 4);
    this.elements.templateInfo.querySelector('.info-content').textContent = JSON.stringify(templateInfos, null, 4);
  }

  _calculateAndDisplayMargins() {
    if (!this.state.cornerSets || this.state.cornerSets.length === 0 || this.transform.originalRects.length === 0) {
      alert('Please process an image and confirm the selection first!');
      return;
    }
    const { width, height } = this.selectedImage;

    // Create a full representation of all areas' data first
    const allAreasData = this.state.cornerSets.map((corners, areaIndex) => {
      const originalRect = this.transform.originalRects[areaIndex];
      const originalCorners = [
        { x: originalRect.x, y: originalRect.y },
        { x: originalRect.x + originalRect.width, y: originalRect.y },
        { x: originalRect.x + originalRect.width, y: originalRect.y + originalRect.height },
        { x: originalRect.x, y: originalRect.y + originalRect.height },
      ];

      const offsets = corners.map((corner, index) => {
        const originalCorner = originalCorners[index];
        return {
          x: Math.abs(corner.x - originalCorner.x) > 0.1 ? Math.round(corner.x - originalCorner.x) : 0,
          y: Math.abs(corner.y - originalCorner.y) > 0.1 ? Math.round(corner.y - originalCorner.y) : 0
        };
      });

      const hasNonZeroOffsets = offsets.some(offset => offset.x !== 0 || offset.y !== 0);
      const [tl, tr, br, bl] = corners;

      const data = {
        areaIndex,
        hasOffsets: hasNonZeroOffsets,
        positions: {
          tlx: Math.round(tl.x), tly: Math.round(tl.y),
          trx: Math.round(tr.x), try: Math.round(tr.y),
          blx: Math.round(bl.x), bly: Math.round(bl.y),
          brx: Math.round(br.x), bry: Math.round(br.y)
        }
      };

      if (hasNonZeroOffsets) {
        data.poMargin = [
          toFloat(offsets[0].x / width), toFloat(offsets[0].y / height),
          toFloat(offsets[1].x / width), toFloat(offsets[1].y / height),
          toFloat(offsets[2].x / width), toFloat(offsets[2].y / height),
          toFloat(offsets[3].x / width), toFloat(offsets[3].y / height)
        ];
        data.templateMargin = [
          offsets[0].x, offsets[0].y,
          offsets[1].x, offsets[1].y,
          offsets[2].x, offsets[2].y,
          offsets[3].x, offsets[3].y
        ];
      }
      return data;
    });

    // Handle potential parsing errors if content is not valid JSON
    let poContent, templateContent;
    try {
      poContent = JSON.parse(this.elements.poInfo.querySelector('.info-content').textContent);
      templateContent = JSON.parse(this.elements.templateInfo.querySelector('.info-content').textContent);
    } catch (e) {
      console.error("Failed to parse info content JSON", e);
      return; // Or handle error appropriately
    }

    allAreasData.forEach(data => {
      if (data.hasOffsets) {
        poContent[data.areaIndex].margins = data.poMargin;
        templateContent[data.areaIndex].margins = data.templateMargin;
      }
    });

    const formatJSON = (obj) => JSON.stringify(obj, null, 4);
    this.elements.poInfo.querySelector('.info-content').textContent = formatJSON(poContent);
    this.elements.templateInfo.querySelector('.info-content').textContent = formatJSON(templateContent);

    // Update Positions info with all areas
    const allPositions = allAreasData.map(d => d.positions);
    this.elements.positionsInfo.querySelector('.info-content').textContent = formatJSON(allPositions);
    this.elements.positionsInfo.style.display = 'block';
  }

  _updateSliderValuePosition(slider, output) {
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const value = parseFloat(slider.value);
    const percent = (value - min) / (max - min);
    const sliderWidth = slider.offsetWidth;
    const thumbWidth = 12; // Approximate thumb width in pixels
    const newPosition = percent * (sliderWidth - thumbWidth);
    output.style.left = `${newPosition + (thumbWidth / 2)}px`;
  }
}

// Initialize event listeners
document.addEventListener('DOMContentLoaded', () => {
  const app = new ImageProcessorApp();
  app.init();
});