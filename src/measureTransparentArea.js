// 创建图片选择器
function createImageSelector() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png';
    return input;
}

// 图片加载处理
function loadImage(file) {
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

// 检测透明区域
function detectTransparentArea(img) {
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

    // 遍历像素查找透明区域边界
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

// 根据宽高比计算最佳矩形框
function calculateAspectRatioRect(transparentArea, aspectRatio, bleedRatio) {
    const { x, y, width, height } = transparentArea;

    let newWidth, newHeight;
    const currentRatio = width / height;

    // 判断当前矩形是宽度优先还是高度优先来适应目标宽高比
    if (currentRatio > aspectRatio) {
        // Too wide, need to heighten
        newWidth = width;
        newHeight = newWidth / aspectRatio;

    } else {
        // Too tall, need to widen
        newHeight = height;
        newWidth = newHeight * aspectRatio;
    }

    // 计算新矩形的中心点（保持与原透明区域中心对齐）
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    const bleeding = newWidth * bleedRatio;
    // prinable size
    const finalWidth = newWidth + 2 * bleeding;
    const finalHeight = newHeight + 2 * bleeding;

    // 计算最终矩形的左上角坐标
    const finalX = centerX - finalWidth / 2;
    const finalY = centerY - finalHeight / 2;

    return {
        x: finalX,
        y: finalY,
        width: finalWidth,
        height: finalHeight
    };
}

// 在文件开头添加新的全局变量
let corners = [];
let isDragging = false;
let selectedCorner = null;
let interactiveCtx;
let finalRect = null;
let transparentRect = null; // 添加透明区域矩形
let isTransparentAreaModified = false; // 添加标记，用于判断用户是否修改了透明区域
let selectedEdge = null; // 添加选中的边
let originalMousePos = null; // 添加鼠标原始位置

// 绘制结果
function drawResult(img, transparentArea, drawFinal = false) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;

    // 绘制棋盘格背景
    const tileSize = 5; // 棋盘格大小
    for (let y = 0; y < canvas.height; y += tileSize) {
        for (let x = 0; x < canvas.width; x += tileSize) {
            ctx.fillStyle = (x + y) % (tileSize * 2) === 0 ? '#ffffff' : '#e0e0e0';
            ctx.fillRect(x, y, tileSize, tileSize);
        }
    }

    // 绘制原图
    ctx.drawImage(img, 0, 0);

    // 绘制透明区域矩形框（绿色）
    ctx.strokeStyle = 'green';
    ctx.lineWidth = 1;
    ctx.strokeRect(
        transparentArea.x,
        transparentArea.y,
        transparentArea.width,
        transparentArea.height
    );

    // 只有在drawFinal为true时才绘制最终的红色矩形框
    if (drawFinal && finalRect) {
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 1;
        ctx.strokeRect(
            finalRect.x,
            finalRect.y,
            finalRect.width,
            finalRect.height
        );

        // 初始化四个顶点坐标
        corners = [
            { x: finalRect.x, y: finalRect.y },
            { x: finalRect.x + finalRect.width, y: finalRect.y },
            { x: finalRect.x + finalRect.width, y: finalRect.y + finalRect.height },
            { x: finalRect.x, y: finalRect.y + finalRect.height }
        ];
    }

    return canvas;
}

// 在 drawResult 函数后添加新的函数
function drawCorners() {
    if (!interactiveCtx || corners.length !== 4) return;

    interactiveCtx.clearRect(0, 0, interactiveCtx.canvas.width, interactiveCtx.canvas.height);


    interactiveCtx.strokeStyle = '#FF00FF';
    interactiveCtx.lineWidth = 2;

    // 绘制连接线
    interactiveCtx.beginPath();
    interactiveCtx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i <= 4; i++) {
        interactiveCtx.lineTo(corners[i % 4].x, corners[i % 4].y);
    }
    interactiveCtx.stroke();

    interactiveCtx.beginPath();
    interactiveCtx.moveTo((corners[0].x + corners[1].x) / 2, (corners[0].y + corners[1].y) / 2);
    interactiveCtx.lineTo((corners[2].x + corners[3].x) / 2, (corners[2].y + corners[3].y) / 2);
    interactiveCtx.stroke();

    interactiveCtx.beginPath();
    interactiveCtx.moveTo((corners[3].x + corners[0].x) / 2, (corners[3].y + corners[0].y) / 2);
    interactiveCtx.lineTo((corners[1].x + corners[2].x) / 2, (corners[1].y + corners[2].y) / 2);
    interactiveCtx.stroke();

    // 绘制顶点
    corners.forEach((corner, index) => {
        interactiveCtx.beginPath();
        interactiveCtx.arc(corner.x, corner.y, 8, 0, Math.PI * 2);
        interactiveCtx.fillStyle = '#00FF00';
        interactiveCtx.fill();
        interactiveCtx.strokeStyle = '#000000';
        interactiveCtx.lineWidth = 2;
        interactiveCtx.stroke();
    });
}

// 添加新的函数用于计算canvas的缩放
function calculateCanvasScale(imageWidth, imageHeight, containerWidth, containerHeight) {
    const scaleX = containerWidth / imageWidth;
    const scaleY = containerHeight / imageHeight;
    return Math.min(scaleX, scaleY, 1); // 不超过原始大小
}

// 添加检查鼠标是否在边上的函数
function findClosestEdge(mousePos) {
    if (!transparentRect) return null;

    const tolerance = 10; // 检测范围
    const edges = [
        { // 上边
            line: {
                x1: transparentRect.x, y1: transparentRect.y,
                x2: transparentRect.x + transparentRect.width, y2: transparentRect.y
            },
            type: 'top'
        },
        { // 右边
            line: {
                x1: transparentRect.x + transparentRect.width, y1: transparentRect.y,
                x2: transparentRect.x + transparentRect.width, y2: transparentRect.y + transparentRect.height
            },
            type: 'right'
        },
        { // 下边
            line: {
                x1: transparentRect.x, y1: transparentRect.y + transparentRect.height,
                x2: transparentRect.x + transparentRect.width, y2: transparentRect.y + transparentRect.height
            },
            type: 'bottom'
        },
        { // 左边
            line: {
                x1: transparentRect.x, y1: transparentRect.y,
                x2: transparentRect.x, y2: transparentRect.y + transparentRect.height
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

// 添加点到线段距离计算函数
function pointToLineDistance(point, line) {
    const A = point.x - line.x1;
    const B = point.y - line.y1;
    const C = line.x2 - line.x1;
    const D = line.y2 - line.y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) {
        param = dot / lenSq;
    }

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

function toFloat(value, precision = 6) {
    return parseFloat(value.toFixed(precision));
}

function getMousePos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (evt.clientX - rect.left) * scaleX,
        y: (evt.clientY - rect.top) * scaleY
    };
}

function findClosestCorner(mousePos) {
    return corners.find(corner => {
        const distance = Math.sqrt(
            Math.pow(corner.x - mousePos.x, 2) +
            Math.pow(corner.y - mousePos.y, 2)
        );
        return distance < 15; // 增加检测范围
    });
}

// 初始化事件监听
document.addEventListener('DOMContentLoaded', () => {
    const imageInput = document.getElementById('imageInput');
    const productWidthInput = document.getElementById('productWidth');
    const productHeightInput = document.getElementById('productHeight');
    const bleedInput = document.getElementById('bleed');
    const analyzeButton = document.getElementById('analyzeButton');
    const confirmButton = document.getElementById('confirmButton');
    const poInfo = document.getElementById('poInfo');
    const templateInfo = document.getElementById('templateInfo');
    const calculateMarginsButton = document.getElementById('calculateMarginsButton');
    const resultCanvas = document.getElementById('resultCanvas');
    const interactiveCanvas = document.getElementById('interactiveCanvas');
    interactiveCtx = interactiveCanvas.getContext('2d');

    let selectedImage = null;

    // 监听文件选择
    imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            selectedImage = await loadImage(file);
            // 重置状态
            transparentRect = null;
            finalRect = null;
            isTransparentAreaModified = false;
            confirmButton.style.display = 'none';
            poInfo.textContent = '';
            templateInfo.textContent = '';
            calculateMarginsButton.style.display = 'none';
        }
    });

    // 修改鼠标事件监听
    interactiveCanvas.addEventListener('mousedown', (e) => {
        const mousePos = getMousePos(interactiveCanvas, e);
        if (finalRect) {
            selectedCorner = findClosestCorner(mousePos);
            if (selectedCorner) {
                isDragging = true;
            }
        } else if (transparentRect) {
            selectedEdge = findClosestEdge(mousePos);
            if (selectedEdge) {
                isDragging = true;
                originalMousePos = mousePos;
                isTransparentAreaModified = true;
            }
        }
    });

    interactiveCanvas.addEventListener('mousemove', (e) => {
        const mousePos = getMousePos(interactiveCanvas, e);

        if (finalRect) {
            const hoveredCorner = findClosestCorner(mousePos);
            interactiveCanvas.style.cursor = hoveredCorner ? 'pointer' : 'default';

            if (isDragging && selectedCorner) {
                selectedCorner.x = mousePos.x;
                selectedCorner.y = mousePos.y;
                drawCorners();
            }
        } else if (transparentRect) {
            const hoveredEdge = findClosestEdge(mousePos);
            interactiveCanvas.style.cursor = hoveredEdge ? 'move' : 'default';

            if (isDragging && selectedEdge && originalMousePos) {
                const dx = mousePos.x - originalMousePos.x;
                const dy = mousePos.y - originalMousePos.y;

                switch (selectedEdge) {
                    case 'left':
                        transparentRect.width -= dx;
                        transparentRect.x += dx;
                        break;
                    case 'right':
                        transparentRect.width = mousePos.x - transparentRect.x;
                        break;
                    case 'top':
                        transparentRect.height -= dy;
                        transparentRect.y += dy;
                        break;
                    case 'bottom':
                        transparentRect.height = mousePos.y - transparentRect.y;
                        break;
                }

                originalMousePos = mousePos;

                // 清除两个画布
                resultCanvas.getContext('2d').clearRect(0, 0, resultCanvas.width, resultCanvas.height);
                interactiveCtx.clearRect(0, 0, interactiveCanvas.width, interactiveCanvas.height);

                // 重新绘制原图和透明区域
                resultCanvas.getContext('2d').drawImage(selectedImage, 0, 0);
                const resultImage = drawResult(selectedImage, transparentRect);
                resultCanvas.getContext('2d').drawImage(resultImage, 0, 0);
            }
        }
    });

    interactiveCanvas.addEventListener('mouseup', () => {
        isDragging = false;
        selectedCorner = null;
        selectedEdge = null;
        originalMousePos = null;
    });

    interactiveCanvas.addEventListener('mouseleave', () => {
        isDragging = false;
        selectedCorner = null;
        selectedEdge = null;
        originalMousePos = null;
    });

    // 监听分析按钮点击
    analyzeButton.addEventListener('click', () => {
        if (!selectedImage) {
            alert('请先选择一个PNG图片！');
            return;
        }

        // 检测透明区域
        transparentRect = detectTransparentArea(selectedImage);

        // 设置画布尺寸和样式
        const container = document.querySelector('.canvas-container');
        const containerWidth = container.clientWidth - 40;
        const containerHeight = container.clientHeight - 40;
        const scale = calculateCanvasScale(selectedImage.width, selectedImage.height, containerWidth, containerHeight);

        resultCanvas.width = selectedImage.width;
        resultCanvas.height = selectedImage.height;
        resultCanvas.style.width = `${selectedImage.width * scale}px`;
        resultCanvas.style.height = `${selectedImage.height * scale}px`;

        interactiveCanvas.width = selectedImage.width;
        interactiveCanvas.height = selectedImage.height;
        interactiveCanvas.style.width = `${selectedImage.width * scale}px`;
        interactiveCanvas.style.height = `${selectedImage.height * scale}px`;

        // 绘制结果
        const resultImage = drawResult(selectedImage, transparentRect);
        resultCanvas.getContext('2d').drawImage(resultImage, 0, 0);

        // 显示确认按钮
        confirmButton.style.display = 'block';
    });

    // 添加确认按钮点击事件
    confirmButton.addEventListener('click', () => {
        if (!transparentRect) return;

        // 获取输入参数
        const productWidth = parseFloat(productWidthInput.value) || 1;
        const productHeight = parseFloat(productHeightInput.value) || 1;
        const aspectRatio = productWidthInput.value && productHeightInput.value
            ? productWidth / productHeight
            : transparentRect.width / transparentRect.height;

        // print aspect ratio
        console.log('aspectRatio', aspectRatio);
        const bleed = parseFloat(bleedInput.value) || 0;
        const bleedRatio = bleed / productWidth;

        // 计算最终矩形
        finalRect = calculateAspectRatioRect(transparentRect, aspectRatio, bleedRatio);

        // 更新显示信息
        poInfo.textContent = `
            "x": ${toFloat(finalRect.x / selectedImage.width, 4)}, 
            "y": ${toFloat(finalRect.y / selectedImage.height, 4)}, 
            "w": ${toFloat(finalRect.width / selectedImage.width, 4)}, 
            "h": ${toFloat(finalRect.height / selectedImage.height, 4)}
        `;

        templateInfo.textContent = `
            "width": ${selectedImage.width}, 
            "height": ${selectedImage.height}, 
            "left": ${Math.round(finalRect.x)}, 
            "top": ${Math.round(finalRect.y)}, 
            "right": ${Math.round(finalRect.x + finalRect.width)}, 
            "bottom": ${Math.round(finalRect.y + finalRect.height)}
        `;

        // 重新绘制结果，这次包括finalRect
        const resultImage = drawResult(selectedImage, transparentRect, true);
        resultCanvas.getContext('2d').drawImage(resultImage, 0, 0);
        drawCorners();

        calculateMarginsButton.style.display = 'block';
    });

    // 添加计算边距按钮的点击事件
    calculateMarginsButton.addEventListener('click', () => {
        if (!corners || corners.length !== 4 || !finalRect) {
            alert('请先分析图片！');
            return;
        }

        // 获取原始矩形的顶点
        const originalCorners = [
            { x: finalRect.x, y: finalRect.y },
            { x: finalRect.x + finalRect.width, y: finalRect.y },
            { x: finalRect.x + finalRect.width, y: finalRect.y + finalRect.height },
            { x: finalRect.x, y: finalRect.y + finalRect.height }
        ];

        // 计算每个顶点的偏移量
        const offsets = corners.map((corner, index) => {
            const originalCorner = originalCorners[index];
            return {
                x: Math.round(corner.x - originalCorner.x),
                y: Math.round(corner.y - originalCorner.y)
            };
        });

        // all offsets item x and y is 0
        if (!offsets.every(offset => offset.x == 0 && offset.y == 0)) {
            if (!poInfo.textContent.includes("margins")) {
                const width = selectedImage.width;
                const height = selectedImage.height;
                poInfo.textContent = poInfo.textContent.trimEnd() + `, "margins": [
                    ${toFloat(offsets[0].x / width)}, ${toFloat(offsets[0].y / height)}, 
                    ${toFloat(offsets[1].x / width)}, ${toFloat(offsets[1].y / height)}, 
                    ${toFloat(offsets[2].x / width)}, ${toFloat(offsets[2].y / height)}, 
                    ${toFloat(offsets[3].x / width)}, ${toFloat(offsets[3].y / height)}
                ]
                `;
            }

            if (!templateInfo.textContent.includes('margins')) {
                // 显示偏移量信息
                templateInfo.textContent = templateInfo.textContent.trimEnd() + `, "margins": [
                    ${offsets[0].x}, ${offsets[0].y}, 
                    ${offsets[1].x}, ${offsets[1].y}, 
                    ${offsets[2].x}, ${offsets[2].y}, 
                    ${offsets[3].x}, ${offsets[3].y}]
                `;
            }
        }
    });
});