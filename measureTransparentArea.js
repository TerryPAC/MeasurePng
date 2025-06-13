// Create image selector
const createImageSelector = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png, image/jpeg, image/webp';
    return input;
}

// Image loading handler
const loadImage = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// Detect transparent area
const detectTransparentArea = (img) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const visited = new Array(canvas.width * canvas.height).fill(false);
    const areas = [];

    // Flood fill function to detect connected transparent areas
    const floodFill = (startX, startY) => {
        const area = {
            minX: startX,
            minY: startY,
            maxX: startX,
            maxY: startY,
            pixels: 0
        };

        // Initialize the stack with the starting coordinates for the flood fill algorithm
        const stack = [[startX, startY]];

        while (stack.length > 0) {
            const [x, y] = stack.pop();
            const index = y * canvas.width + x;

            if (x < 10 || x >= canvas.width - 10 ||
                y < 10 || y >= canvas.height - 10 ||
                visited[index]) {
                continue;
            }

            const alpha = data[(y * canvas.width + x) * 4 + 3];
            if (alpha >= 192) {
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

    // Find all transparent areas
    for (let y = 10; y < canvas.height - 10; y++) {
        for (let x = 10; x < canvas.width - 10; x++) {
            const index = y * canvas.width + x;
            if (!visited[index]) {
                const alpha = data[(y * canvas.width + x) * 4 + 3];
                if (alpha < 192) {
                    const area = floodFill(x, y);
                    if (area.pixels > 0) {
                        areas.push(area);
                    }
                }
            }
        }
    }

    // Find the largest area
    if (areas.length === 0) {
        return { x: 20, y: 20, width: img.width - 40, height: img.height - 40 };
    }

    console.log(areas);

    const largestArea = areas.reduce((max, current) => current.pixels > max.pixels ? current : max, areas[0]);

    return {
        x: largestArea.minX - 1,
        y: largestArea.minY - 1,
        width: largestArea.maxX - largestArea.minX + 2,
        height: largestArea.maxY - largestArea.minY + 2
    };
}

// Calculate best rectangle based on aspect ratio
const calculateAspectRatioRect = (transparentArea, aspectRatio, bleedRatio) => {
    const { x, y, width, height } = transparentArea;

    let newWidth, newHeight;
    const currentRatio = width / height;

    // Determine if current rectangle should prioritize width or height to match target aspect ratio
    if (currentRatio > aspectRatio) {
        // Too wide, need to heighten
        newWidth = width;
        newHeight = newWidth / aspectRatio;
    } else {
        // Too tall, need to widen
        newHeight = height;
        newWidth = newHeight * aspectRatio;
    }

    // Calculate new rectangle center point (keep aligned with original transparent area center)
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    const bleeding = newWidth * bleedRatio;
    // printable size
    const finalWidth = newWidth + 2 * bleeding;
    const finalHeight = newHeight + 2 * bleeding;

    // Calculate final rectangle top-left coordinates
    const finalX = centerX - finalWidth / 2;
    const finalY = centerY - finalHeight / 2;

    return {
        x: finalX,
        y: finalY,
        width: finalWidth,
        height: finalHeight
    };
}

// Add global variables at the beginning of the file
const state = {
    corners: [],
    isDragging: false,
    selectedCorner: null,
    interactiveCtx: null,
    finalRect: null,
    transparentRect: null,
    isTransparentAreaModified: false,
    selectedEdge: null,
    originalMousePos: null,
    canvasOffset: { x: 0, y: 0 }
};

// Draw result
const drawResult = (img, transparentArea, drawFinal = false) => {
    const canvasWidth = img.width * CANVAS_SCALE_FACTOR;
    const canvasHeight = img.height * CANVAS_SCALE_FACTOR;
    const offsetX = (canvasWidth - img.width) / 2;
    const offsetY = (canvasHeight - img.height) / 2;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Draw checkerboard background
    const tileSize = 5; // Checkerboard tile size
    for (let y = 0; y < canvas.height; y += tileSize) {
        for (let x = 0; x < canvas.width; x += tileSize) {
            ctx.fillStyle = (x + y) % (tileSize * 2) === 0 ? '#ffffff' : '#e0e0e0';
            ctx.fillRect(x, y, tileSize, tileSize);
        }
    }

    // Draw original image
    ctx.drawImage(img, offsetX, offsetY);

    // Draw transparent area rectangle (green)
    ctx.strokeStyle = 'green';
    ctx.lineWidth = 1;
    ctx.strokeRect(
        transparentArea.x + offsetX,
        transparentArea.y + offsetY,
        transparentArea.width,
        transparentArea.height
    );

    // Only draw the final red rectangle when drawFinal is true
    if (drawFinal && state.finalRect) {
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 1;
        ctx.strokeRect(
            state.finalRect.x + offsetX,
            state.finalRect.y + offsetY,
            state.finalRect.width,
            state.finalRect.height
        );

        // Initialize four corner coordinates
        state.corners = [
            { x: state.finalRect.x, y: state.finalRect.y },
            { x: state.finalRect.x + state.finalRect.width, y: state.finalRect.y },
            { x: state.finalRect.x + state.finalRect.width, y: state.finalRect.y + state.finalRect.height },
            { x: state.finalRect.x, y: state.finalRect.y + state.finalRect.height }
        ];
    }

    return canvas;
}

// Add new function after drawResult function
const drawCorners = () => {
    if (!state.interactiveCtx || state.corners.length !== 4) return;

    const offsetX = state.canvasOffset.x;
    const offsetY = state.canvasOffset.y;

    state.interactiveCtx.clearRect(0, 0, state.interactiveCtx.canvas.width, state.interactiveCtx.canvas.height);

    state.interactiveCtx.strokeStyle = '#FF00FF';
    state.interactiveCtx.lineWidth = 2;

    // Draw connecting lines
    state.interactiveCtx.beginPath();
    state.interactiveCtx.moveTo(state.corners[0].x + offsetX, state.corners[0].y + offsetY);
    for (let i = 1; i <= 4; i++) {
        state.interactiveCtx.lineTo(state.corners[i % 4].x + offsetX, state.corners[i % 4].y + offsetY);
    }
    state.interactiveCtx.stroke();

    // Draw central axis
    state.interactiveCtx.beginPath();
    state.interactiveCtx.moveTo((state.corners[0].x + state.corners[1].x) / 2 + offsetX, (state.corners[0].y + state.corners[1].y) / 2 + offsetY);
    state.interactiveCtx.lineTo((state.corners[2].x + state.corners[3].x) / 2 + offsetX, (state.corners[2].y + state.corners[3].y) / 2 + offsetY);
    state.interactiveCtx.stroke();

    state.interactiveCtx.beginPath();
    state.interactiveCtx.moveTo((state.corners[3].x + state.corners[0].x) / 2 + offsetX, (state.corners[3].y + state.corners[0].y) / 2 + offsetY);
    state.interactiveCtx.lineTo((state.corners[1].x + state.corners[2].x) / 2 + offsetX, (state.corners[1].y + state.corners[2].y) / 2 + offsetY);
    state.interactiveCtx.stroke();

    // Draw vertices
    state.corners.forEach((corner, index) => {
        state.interactiveCtx.beginPath();
        state.interactiveCtx.arc(corner.x + offsetX, corner.y + offsetY, 8, 0, Math.PI * 2);
        state.interactiveCtx.fillStyle = '#00FF00';
        state.interactiveCtx.fill();
        state.interactiveCtx.strokeStyle = '#000000';
        state.interactiveCtx.lineWidth = 2;
        state.interactiveCtx.stroke();
    });
}

// Add new function to calculate canvas scaling
const calculateCanvasScale = (imageWidth, imageHeight, containerWidth, containerHeight) => {
    const scaleX = containerWidth / imageWidth;
    const scaleY = containerHeight / imageHeight;
    return Math.min(scaleX, scaleY, 1); // Do not exceed original size
}

// Add function to check if mouse is on edge
const findClosestEdge = (mousePos) => {
    if (!state.transparentRect) return null;

    const tolerance = 10; // Detection range
    const edges = [
        { // Top edge
            line: {
                x1: state.transparentRect.x, y1: state.transparentRect.y,
                x2: state.transparentRect.x + state.transparentRect.width, y2: state.transparentRect.y
            },
            type: 'top'
        },
        { // Right edge
            line: {
                x1: state.transparentRect.x + state.transparentRect.width, y1: state.transparentRect.y,
                x2: state.transparentRect.x + state.transparentRect.width, y2: state.transparentRect.y + state.transparentRect.height
            },
            type: 'right'
        },
        { // Bottom edge
            line: {
                x1: state.transparentRect.x, y1: state.transparentRect.y + state.transparentRect.height,
                x2: state.transparentRect.x + state.transparentRect.width, y2: state.transparentRect.y + state.transparentRect.height
            },
            type: 'bottom'
        },
        { // Left edge
            line: {
                x1: state.transparentRect.x, y1: state.transparentRect.y,
                x2: state.transparentRect.x, y2: state.transparentRect.y + state.transparentRect.height
            },
            type: 'left'
        }
    ];

    for (const edge of edges) {
        const dist = pointToLineDistance(mousePos, edge.line);
        if (dist < tolerance) {
            return edge.type;
        }
    }
    return null;
}

// Add function to calculate point to line distance
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
}

// Utility functions
const toFloat = (value, precision = 6) => parseFloat(value.toFixed(precision));

const CANVAS_SCALE_FACTOR = 1.28;

const getMousePos = (canvas, evt) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (evt.clientX - rect.left) * scaleX;
    const canvasY = (evt.clientY - rect.top) * scaleY;
    return {
        canvas: { x: canvasX, y: canvasY },
        image: {
            x: canvasX - state.canvasOffset.x,
            y: canvasY - state.canvasOffset.y
        }
    };
}

const findClosestCorner = (mousePos) => {
    return state.corners.find(corner => {
        const distance = Math.sqrt(
            Math.pow(corner.x - mousePos.x, 2) +
            Math.pow(corner.y - mousePos.y, 2)
        );
        return distance < 15; // Increase detection range
    });
}

// Initialize event listeners
document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const elements = {
        imageInput: document.getElementById('imageInput'),
        productWidthInput: document.getElementById('productWidth'),
        productHeightInput: document.getElementById('productHeight'),
        bleedInput: document.getElementById('bleed'),
        analyzeButton: document.getElementById('analyzeButton'),
        confirmButton: document.getElementById('confirmButton'),
        poInfo: document.getElementById('poInfo'),
        templateInfo: document.getElementById('templateInfo'),
        calculateMarginsButton: document.getElementById('calculateMarginsButton'),
        resultCanvas: document.getElementById('resultCanvas'),
        interactiveCanvas: document.getElementById('interactiveCanvas'),
        transformControls: document.getElementById('transformControls'),
        rotationControl: document.getElementById('rotationControl'),
        scaleControl: document.getElementById('scaleControl'),
        rotationValue: document.getElementById('rotationValue'),
        scaleValue: document.getElementById('scaleValue')
    };

    state.interactiveCtx = elements.interactiveCanvas.getContext('2d');
    let selectedImage = null;

    // Add transformation state
    const transform = {
        rotation: 0,
        scale: 1,
        originalRect: null
    };

    // Reset application state
    const resetState = () => {
        state.transparentRect = null;
        state.finalRect = null;
        state.isTransparentAreaModified = false;
        elements.confirmButton.style.visibility = 'hidden';
        elements.transformControls.style.display = 'none';
        elements.poInfo.querySelector('.info-content').textContent = '';
        elements.templateInfo.querySelector('.info-content').textContent = '';
        elements.calculateMarginsButton.style.visibility = 'hidden';
        transform.rotation = 0;
        transform.scale = 1;
        transform.originalRect = null;
        elements.rotationControl.value = 0;
        elements.scaleControl.value = 100;
        elements.rotationValue.textContent = '0°';
        elements.scaleValue.textContent = '1.0';
    };

    // Listen for file selection
    elements.imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            selectedImage = await loadImage(file);
            resetState();
        }
    });

    // Mouse event handlers
    const handleMouseDown = (e) => {
        const mousePos = getMousePos(elements.interactiveCanvas, e).image;
        if (state.finalRect) {
            state.selectedCorner = findClosestCorner(mousePos);
            if (state.selectedCorner) {
                state.isDragging = true;
            }
        } else if (state.transparentRect) {
            state.selectedEdge = findClosestEdge(mousePos);
            if (state.selectedEdge) {
                state.isDragging = true;
                state.originalMousePos = mousePos;
                state.isTransparentAreaModified = true;
            }
        }
    };

    const handleMouseMove = (e) => {
        const mousePos = getMousePos(elements.interactiveCanvas, e).image;

        if (state.finalRect) {
            const hoveredCorner = findClosestCorner(mousePos);
            elements.interactiveCanvas.style.cursor = hoveredCorner ? 'pointer' : 'default';

            if (state.isDragging && state.selectedCorner) {
                state.selectedCorner.x = mousePos.x;
                state.selectedCorner.y = mousePos.y;
                drawCorners();
            }
        } else if (state.transparentRect) {
            const hoveredEdge = findClosestEdge(mousePos);
            elements.interactiveCanvas.style.cursor = hoveredEdge ? 'move' : 'default';

            if (state.isDragging && state.selectedEdge && state.originalMousePos) {
                const dx = mousePos.x - state.originalMousePos.x;
                const dy = mousePos.y - state.originalMousePos.y;

                switch (state.selectedEdge) {
                    case 'left':
                        state.transparentRect.width -= dx;
                        state.transparentRect.x += dx;
                        break;
                    case 'right':
                        state.transparentRect.width = mousePos.x - state.transparentRect.x;
                        break;
                    case 'top':
                        state.transparentRect.height -= dy;
                        state.transparentRect.y += dy;
                        break;
                    case 'bottom':
                        state.transparentRect.height = mousePos.y - state.transparentRect.y;
                        break;
                }

                state.originalMousePos = mousePos;

                // Clear result canvas before redrawing
                elements.resultCanvas.getContext('2d').clearRect(0, 0, elements.resultCanvas.width, elements.resultCanvas.height);

                // Redraw result with updated transparent area
                const resultImage = drawResult(selectedImage, state.transparentRect, false);
                elements.resultCanvas.getContext('2d').drawImage(resultImage, 0, 0);

                // Clear interactive canvas, as it's only for corners
                state.interactiveCtx.clearRect(0, 0, elements.interactiveCanvas.width, elements.interactiveCanvas.height);
            }
        }
    };

    const resetMouseState = () => {
        state.isDragging = false;
        state.selectedCorner = null;
        state.selectedEdge = null;
        state.originalMousePos = null;
    };

    elements.interactiveCanvas.addEventListener('mousedown', handleMouseDown);
    elements.interactiveCanvas.addEventListener('mousemove', handleMouseMove);
    elements.interactiveCanvas.addEventListener('mouseup', resetMouseState);
    elements.interactiveCanvas.addEventListener('mouseleave', resetMouseState);

    // Copy button functionality
    document.querySelectorAll('.copy-button').forEach(button => {
        button.addEventListener('click', async () => {
            const targetId = button.getAttribute('data-target');
            const targetElement = document.getElementById(targetId);
            const textToCopy = targetElement.querySelector('.info-content').textContent.trim();

            try {
                await navigator.clipboard.writeText(textToCopy);
                // Show copy success visual feedback
                const originalColor = button.style.color;
                button.style.color = '#4CAF50';
                setTimeout(() => { button.style.color = originalColor; }, 1000);
            } catch (err) {
                alert('Copy failed!');
            }
        });
    });

    // Add rotation and scale functions
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

    const updateRect = () => {
        if (!transform.originalRect || !state.finalRect) return;

        const center = {
            x: transform.originalRect.x + transform.originalRect.width / 2,
            y: transform.originalRect.y + transform.originalRect.height / 2
        };

        // Get original corners
        const originalCorners = [
            { x: transform.originalRect.x, y: transform.originalRect.y },
            { x: transform.originalRect.x + transform.originalRect.width, y: transform.originalRect.y },
            { x: transform.originalRect.x + transform.originalRect.width, y: transform.originalRect.y + transform.originalRect.height },
            { x: transform.originalRect.x, y: transform.originalRect.y + transform.originalRect.height }
        ];

        // Apply transformations
        state.corners = originalCorners.map(corner => {
            // First rotate
            const rotated = rotatePoint(corner, center, transform.rotation);
            // Then scale
            return scalePoint(rotated, center, transform.scale);
        });

        console.log(originalCorners);
        console.log(state.corners);
        drawCorners();
    };

    // Add transformation control event listeners
    elements.rotationControl.addEventListener('input', (e) => {
        transform.rotation = parseFloat(e.target.value);
        elements.rotationValue.textContent = `${transform.rotation}°`;
        updateRect();
    });

    elements.scaleControl.addEventListener('input', (e) => {
        transform.scale = parseFloat(e.target.value) / 100;
        elements.scaleValue.textContent = transform.scale.toFixed(2);
        updateRect();
    });

    // Analyze button click
    elements.analyzeButton.addEventListener('click', () => {
        if (!selectedImage) {
            alert('Please choose a png first!');
            return;
        }

        // Detect transparent area
        state.transparentRect = detectTransparentArea(selectedImage);

        // Set canvas size and style
        const canvasWidth = selectedImage.width * CANVAS_SCALE_FACTOR;
        const canvasHeight = selectedImage.height * CANVAS_SCALE_FACTOR;
        state.canvasOffset.x = (canvasWidth - selectedImage.width) / 2;
        state.canvasOffset.y = (canvasHeight - selectedImage.height) / 2;

        const container = document.querySelector('.canvas-container');
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const scale = calculateCanvasScale(canvasWidth, canvasHeight, containerWidth, containerHeight);

        elements.resultCanvas.width = canvasWidth;
        elements.resultCanvas.height = canvasHeight;
        elements.resultCanvas.style.width = `${canvasWidth * scale}px`;
        elements.resultCanvas.style.height = `${canvasHeight * scale}px`;

        elements.interactiveCanvas.width = canvasWidth;
        elements.interactiveCanvas.height = canvasHeight;
        elements.interactiveCanvas.style.width = `${canvasWidth * scale}px`;
        elements.interactiveCanvas.style.height = `${canvasHeight * scale}px`;

        // Draw result
        const resultImage = drawResult(selectedImage, state.transparentRect);
        elements.resultCanvas.getContext('2d').drawImage(resultImage, 0, 0);

        // Show confirm button
        elements.confirmButton.style.visibility = 'visible';
    });

    // Confirm button click event
    elements.confirmButton.addEventListener('click', () => {
        if (!state.transparentRect) return;

        // Get input parameters
        const productWidth = parseFloat(elements.productWidthInput.value) || 1;
        const productHeight = parseFloat(elements.productHeightInput.value) || 1;
        const aspectRatio = elements.productWidthInput.value && elements.productHeightInput.value
            ? productWidth / productHeight
            : state.transparentRect.width / state.transparentRect.height;

        const bleed = parseFloat(elements.bleedInput.value) || 0;
        const bleedRatio = bleed / productWidth;

        // Calculate final rectangle
        state.finalRect = calculateAspectRatioRect(state.transparentRect, aspectRatio, bleedRatio);
        transform.originalRect = { ...state.finalRect };

        // Show transform controls
        elements.transformControls.style.display = 'block';

        // Update display information
        const poInfoText = `
            "x": ${toFloat(state.finalRect.x / selectedImage.width, 4)}, 
            "y": ${toFloat(state.finalRect.y / selectedImage.height, 4)}, 
            "w": ${toFloat(state.finalRect.width / selectedImage.width, 4)}, 
            "h": ${toFloat(state.finalRect.height / selectedImage.height, 4)}
        `;
        elements.poInfo.querySelector('.info-content').textContent = poInfoText;

        const templateInfoText = `
            "width": ${selectedImage.width}, 
            "height": ${selectedImage.height}, 
            "left": ${Math.round(state.finalRect.x)}, 
            "top": ${Math.round(state.finalRect.y)}, 
            "right": ${Math.round(state.finalRect.x + state.finalRect.width)}, 
            "bottom": ${Math.round(state.finalRect.y + state.finalRect.height)}
        `;
        elements.templateInfo.querySelector('.info-content').textContent = templateInfoText;

        // Redraw result, this time including finalRect
        const resultImage = drawResult(selectedImage, state.transparentRect, true);
        elements.resultCanvas.getContext('2d').drawImage(resultImage, 0, 0);
        drawCorners();

        // Show calculate margins button
        elements.calculateMarginsButton.style.visibility = 'visible';
    });

    // Calculate margins button click event
    elements.calculateMarginsButton.addEventListener('click', () => {
        if (!state.corners || state.corners.length !== 4 || !state.finalRect) {
            alert('Please detect the transparent area and confirm the rectangle first!');
            return;
        }

        // Get original rectangle vertices
        const originalCorners = [
            { x: state.finalRect.x, y: state.finalRect.y },
            { x: state.finalRect.x + state.finalRect.width, y: state.finalRect.y },
            { x: state.finalRect.x + state.finalRect.width, y: state.finalRect.y + state.finalRect.height },
            { x: state.finalRect.x, y: state.finalRect.y + state.finalRect.height }
        ];

        // Calculate offset for each vertex
        const offsets = state.corners.map((corner, index) => {
            const originalCorner = originalCorners[index];
            return {
                x: Math.abs(corner.x - originalCorner.x) > 1 ? Math.round(corner.x - originalCorner.x) : 0,
                y: Math.abs(corner.y - originalCorner.y) > 1 ? Math.round(corner.y - originalCorner.y) : 0
            };
        });

        const width = selectedImage.width;
        const height = selectedImage.height;
        const marginInfo = offsets.every(offset => offset.x == 0 && offset.y == 0) ? null : `"margins": [
            ${toFloat(offsets[0].x / width)}, ${toFloat(offsets[0].y / height)}, 
            ${toFloat(offsets[1].x / width)}, ${toFloat(offsets[1].y / height)}, 
            ${toFloat(offsets[2].x / width)}, ${toFloat(offsets[2].y / height)}, 
            ${toFloat(offsets[3].x / width)}, ${toFloat(offsets[3].y / height)}
        ]`;

        const poInfoContent = elements.poInfo.querySelector('.info-content');
        if (poInfoContent.textContent.includes("margins")) {
            poInfoContent.textContent = marginInfo
                ? poInfoContent.textContent.replace(/"margins":\s*\[[^\]]*\]/, marginInfo)
                : poInfoContent.textContent.replace(/,\s*"margins":\s*\[[^\]]*\]/, '');
        } else if (marginInfo) {
            poInfoContent.textContent = poInfoContent.textContent.trimEnd() + `, ${marginInfo}`;
        }

        const templateMarginInfo = offsets.every(offset => offset.x == 0 && offset.y == 0) ? null : `"margins": [
            ${offsets[0].x}, ${offsets[0].y}, 
            ${offsets[1].x}, ${offsets[1].y}, 
            ${offsets[2].x}, ${offsets[2].y}, 
            ${offsets[3].x}, ${offsets[3].y}
        ]`;
        const templateInfoContent = elements.templateInfo.querySelector('.info-content');
        if (templateInfoContent.textContent.includes("margins")) {
            templateInfoContent.textContent = templateMarginInfo
                ? templateInfoContent.textContent.replace(/"margins":\s*\[[^\]]*\]/, templateMarginInfo)
                : templateInfoContent.textContent.replace(/,\s*"margins":\s*\[[^\]]*\]/, '');
        } else if (templateMarginInfo) {
            templateInfoContent.textContent = templateInfoContent.textContent.trimEnd() + `, ${templateMarginInfo}`;
        }
    });
});