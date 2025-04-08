// Create image selector
const createImageSelector = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png';
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

    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;

    // Iterate through pixels to find transparent area boundaries
    for (let y = 10; y < canvas.height - 10; y++) {
        for (let x = 10; x < canvas.width - 10; x++) {
            const alpha = data[(y * canvas.width + x) * 4 + 3];
            if (alpha < 192) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    }

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
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
    // prinable size
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
    originalMousePos: null
};

// Draw result
const drawResult = (img, transparentArea, drawFinal = false) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;

    // Draw checkerboard background
    const tileSize = 5; // Checkerboard tile size
    for (let y = 0; y < canvas.height; y += tileSize) {
        for (let x = 0; x < canvas.width; x += tileSize) {
            ctx.fillStyle = (x + y) % (tileSize * 2) === 0 ? '#ffffff' : '#e0e0e0';
            ctx.fillRect(x, y, tileSize, tileSize);
        }
    }

    // Draw original image
    ctx.drawImage(img, 0, 0);

    // Draw transparent area rectangle (green)
    ctx.strokeStyle = 'green';
    ctx.lineWidth = 1;
    ctx.strokeRect(
        transparentArea.x,
        transparentArea.y,
        transparentArea.width,
        transparentArea.height
    );

    // Only draw the final red rectangle when drawFinal is true
    if (drawFinal && state.finalRect) {
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 1;
        ctx.strokeRect(
            state.finalRect.x,
            state.finalRect.y,
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

    state.interactiveCtx.clearRect(0, 0, state.interactiveCtx.canvas.width, state.interactiveCtx.canvas.height);

    state.interactiveCtx.strokeStyle = '#FF00FF';
    state.interactiveCtx.lineWidth = 2;

    // Draw connecting lines
    state.interactiveCtx.beginPath();
    state.interactiveCtx.moveTo(state.corners[0].x, state.corners[0].y);
    for (let i = 1; i <= 4; i++) {
        state.interactiveCtx.lineTo(state.corners[i % 4].x, state.corners[i % 4].y);
    }
    state.interactiveCtx.stroke();

    state.interactiveCtx.beginPath();
    state.interactiveCtx.moveTo((state.corners[0].x + state.corners[1].x) / 2, (state.corners[0].y + state.corners[1].y) / 2);
    state.interactiveCtx.lineTo((state.corners[2].x + state.corners[3].x) / 2, (state.corners[2].y + state.corners[3].y) / 2);
    state.interactiveCtx.stroke();

    state.interactiveCtx.beginPath();
    state.interactiveCtx.moveTo((state.corners[3].x + state.corners[0].x) / 2, (state.corners[3].y + state.corners[0].y) / 2);
    state.interactiveCtx.lineTo((state.corners[1].x + state.corners[2].x) / 2, (state.corners[1].y + state.corners[2].y) / 2);
    state.interactiveCtx.stroke();

    // Draw vertices
    state.corners.forEach((corner, index) => {
        state.interactiveCtx.beginPath();
        state.interactiveCtx.arc(corner.x, corner.y, 8, 0, Math.PI * 2);
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

const getMousePos = (canvas, evt) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (evt.clientX - rect.left) * scaleX,
        y: (evt.clientY - rect.top) * scaleY
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
        interactiveCanvas: document.getElementById('interactiveCanvas')
    };

    state.interactiveCtx = elements.interactiveCanvas.getContext('2d');
    let selectedImage = null;

    // Reset application state
    const resetState = () => {
        state.transparentRect = null;
        state.finalRect = null;
        state.isTransparentAreaModified = false;
        elements.confirmButton.style.display = 'none';
        elements.poInfo.querySelector('.info-content').textContent = '';
        elements.templateInfo.querySelector('.info-content').textContent = '';
        elements.calculateMarginsButton.style.display = 'none';
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
        const mousePos = getMousePos(elements.interactiveCanvas, e);
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
        const mousePos = getMousePos(elements.interactiveCanvas, e);

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

                // Clear both canvases
                elements.resultCanvas.getContext('2d').clearRect(0, 0, elements.resultCanvas.width, elements.resultCanvas.height);
                state.interactiveCtx.clearRect(0, 0, elements.interactiveCanvas.width, elements.interactiveCanvas.height);

                // Redraw original image and transparent area
                elements.resultCanvas.getContext('2d').drawImage(selectedImage, 0, 0);
                const resultImage = drawResult(selectedImage, state.transparentRect);
                elements.resultCanvas.getContext('2d').drawImage(resultImage, 0, 0);
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

    // Analyze button click
    elements.analyzeButton.addEventListener('click', () => {
        if (!selectedImage) {
            alert('Please choose a png first!');
            return;
        }

        // Detect transparent area
        state.transparentRect = detectTransparentArea(selectedImage);

        // Set canvas size and style
        const container = document.querySelector('.canvas-container');
        const containerWidth = container.clientWidth - 40;
        const containerHeight = container.clientHeight - 40;
        const scale = calculateCanvasScale(selectedImage.width, selectedImage.height, containerWidth, containerHeight);

        elements.resultCanvas.width = selectedImage.width;
        elements.resultCanvas.height = selectedImage.height;
        elements.resultCanvas.style.width = `${selectedImage.width * scale}px`;
        elements.resultCanvas.style.height = `${selectedImage.height * scale}px`;

        elements.interactiveCanvas.width = selectedImage.width;
        elements.interactiveCanvas.height = selectedImage.height;
        elements.interactiveCanvas.style.width = `${selectedImage.width * scale}px`;
        elements.interactiveCanvas.style.height = `${selectedImage.height * scale}px`;

        // Draw result
        const resultImage = drawResult(selectedImage, state.transparentRect);
        elements.resultCanvas.getContext('2d').drawImage(resultImage, 0, 0);

        // Show confirm button
        elements.confirmButton.style.display = 'block';
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

        // print aspect ratio
        const bleed = parseFloat(elements.bleedInput.value) || 0;
        const bleedRatio = bleed / productWidth;

        // Calculate final rectangle
        state.finalRect = calculateAspectRatioRect(state.transparentRect, aspectRatio, bleedRatio);

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

        elements.calculateMarginsButton.style.display = 'block';
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

        // all offsets item x and y is 0
        if (offsets.every(offset => offset.x == 0 && offset.y == 0)) {
            console.log('No offsets detected!');
            return;
        }

        const width = selectedImage.width;
        const height = selectedImage.height;
        const marginInfo = `[
            ${toFloat(offsets[0].x / width)}, ${toFloat(offsets[0].y / height)}, 
            ${toFloat(offsets[1].x / width)}, ${toFloat(offsets[1].y / height)}, 
            ${toFloat(offsets[2].x / width)}, ${toFloat(offsets[2].y / height)}, 
            ${toFloat(offsets[3].x / width)}, ${toFloat(offsets[3].y / height)}
        ]`;

        const poInfoContent = elements.poInfo.querySelector('.info-content');
        if (poInfoContent.textContent.includes("margins")) {
            poInfoContent.textContent = poInfoContent.textContent.replace(/"margins":\s*\[[^\]]*\]/, `"margins": ${marginInfo}`);
        } else {
            poInfoContent.textContent = poInfoContent.textContent.trimEnd() + `, "margins": ${marginInfo}`;
        }

        const templateMarginInfo = `[
            ${offsets[0].x}, ${offsets[0].y}, 
            ${offsets[1].x}, ${offsets[1].y}, 
            ${offsets[2].x}, ${offsets[2].y}, 
            ${offsets[3].x}, ${offsets[3].y}
        ]`;
        const templateInfoContent = elements.templateInfo.querySelector('.info-content');
        if (templateInfoContent.textContent.includes('margins')) {
            templateInfoContent.textContent = templateInfoContent.textContent.replace(/"margins":\s*\[[^\]]*\]/, `"margins": ${templateMarginInfo}`);
        } else {
            templateInfoContent.textContent = templateInfoContent.textContent.trimEnd() + `, "margins": ${templateMarginInfo}`;
        }
    });
});