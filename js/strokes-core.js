function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function cloneStroke(stroke) {
  return {
    ...stroke,
    points: Array.isArray(stroke.points) ? stroke.points.map(clonePoint) : []
  };
}

function cloneStrokeCollection(collection) {
  if (!Array.isArray(collection) || collection.length === 0) {
    return [];
  }

  return collection
    .filter((stroke) => stroke && Array.isArray(stroke.points) && stroke.points.length > 0)
    .map(cloneStroke);
}

function normalizeStrokeCollection(collection) {
  if (!Array.isArray(collection) || collection.length <= 0) {
    return [];
  }

  const normalized = [];
  for (const sourceStroke of collection) {
    if (!sourceStroke || !Array.isArray(sourceStroke.points)) {
      continue;
    }

    const points = [];
    for (const sourcePoint of sourceStroke.points) {
      const x = Number(sourcePoint && sourcePoint.x);
      const y = Number(sourcePoint && sourcePoint.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }

      points.push({ x, y });
    }

    if (points.length <= 0) {
      continue;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    normalized.push({
      kind: sourceStroke.kind === "pixel-eraser" ? "pixel-eraser" : "pen",
      color: normalizeHexColor(sourceStroke.color) || "#111111",
      widthPx: Math.max(1, Number(sourceStroke.widthPx) || 1),
      points,
      minX,
      minY,
      maxX,
      maxY
    });
  }

  return normalized;
}

function createStrokeRecord(kind, startPoint) {
  const point = clonePoint(startPoint);
  const sourceWidth = kind === "pixel-eraser"
    ? Number(eraserWidthInput.value)
    : Number(lineWidthInput.value);
  const widthPx = Math.max(1, sourceWidth * pixelRatio);

  return {
    kind,
    color: penColorInput.value,
    widthPx,
    points: [point],
    minX: point.x,
    minY: point.y,
    maxX: point.x,
    maxY: point.y
  };
}

function appendPointToStroke(stroke, point) {
  const next = clonePoint(point);
  stroke.points.push(next);
  stroke.minX = Math.min(stroke.minX, next.x);
  stroke.minY = Math.min(stroke.minY, next.y);
  stroke.maxX = Math.max(stroke.maxX, next.x);
  stroke.maxY = Math.max(stroke.maxY, next.y);
}

function drawStrokePath(stroke, targetContext = ctx) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) {
    return;
  }

  const isPixelEraser = stroke.kind === "pixel-eraser";
  targetContext.lineJoin = "round";
  targetContext.lineCap = "round";
  targetContext.globalCompositeOperation = isPixelEraser ? "destination-out" : "source-over";
  targetContext.strokeStyle = isPixelEraser ? "rgba(0, 0, 0, 1)" : stroke.color;
  targetContext.fillStyle = isPixelEraser ? "rgba(0, 0, 0, 1)" : stroke.color;
  targetContext.lineWidth = Math.max(1, Number(stroke.widthPx));

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    targetContext.beginPath();
    targetContext.arc(point.x, point.y, targetContext.lineWidth / 2, 0, Math.PI * 2);
    targetContext.fill();
    return;
  }

  const points = stroke.points;
  let previous = points[0];
  let previousMidpoint = previous;

  targetContext.beginPath();
  targetContext.moveTo(previousMidpoint.x, previousMidpoint.y);

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const midpoint = getMidpoint(previous, current);
    targetContext.quadraticCurveTo(previous.x, previous.y, midpoint.x, midpoint.y);
    previous = current;
    previousMidpoint = midpoint;
  }

  targetContext.stroke();
}

function redrawAllStrokes() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const stroke of strokes) {
    drawStrokePath(stroke);
  }
}

function scaleStrokeCollection(collection, scaleX, scaleY) {
  if (!Array.isArray(collection) || collection.length === 0) {
    return;
  }

  const widthScale = (scaleX + scaleY) / 2;

  for (const stroke of collection) {
    if (!stroke.points.length) {
      continue;
    }

    stroke.minX = Number.POSITIVE_INFINITY;
    stroke.minY = Number.POSITIVE_INFINITY;
    stroke.maxX = Number.NEGATIVE_INFINITY;
    stroke.maxY = Number.NEGATIVE_INFINITY;

    for (const point of stroke.points) {
      point.x *= scaleX;
      point.y *= scaleY;
      stroke.minX = Math.min(stroke.minX, point.x);
      stroke.minY = Math.min(stroke.minY, point.y);
      stroke.maxX = Math.max(stroke.maxX, point.x);
      stroke.maxY = Math.max(stroke.maxY, point.y);
    }

    stroke.widthPx = Math.max(1, stroke.widthPx * widthScale);
  }
}

function scaleStoredStrokes(scaleX, scaleY) {
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    return;
  }

  scaleStrokeCollection(strokes, scaleX, scaleY);
  scaleStrokeCollection(boardStrokeSnapshot, scaleX, scaleY);

  for (const snapshot of pdfPageStrokeSnapshots.values()) {
    scaleStrokeCollection(snapshot, scaleX, scaleY);
  }
}
