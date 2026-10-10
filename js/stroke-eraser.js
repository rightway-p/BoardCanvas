function distancePointToSegment(point, a, b) {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const apX = point.x - a.x;
  const apY = point.y - a.y;
  const lengthSq = (abX * abX) + (abY * abY);

  if (lengthSq <= 0.0001) {
    return Math.hypot(apX, apY);
  }

  const t = Math.max(0, Math.min(1, ((apX * abX) + (apY * abY)) / lengthSq));
  const nearestX = a.x + (abX * t);
  const nearestY = a.y + (abY * t);
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

function isPointNearStroke(point, stroke, radius) {
  const points = stroke.points;
  if (!points.length) {
    return false;
  }

  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= radius;
  }

  for (let index = 1; index < points.length; index += 1) {
    if (distancePointToSegment(point, points[index - 1], points[index]) <= radius) {
      return true;
    }
  }

  return false;
}

function getStrokeEraserRadius() {
  return Math.max(4 * pixelRatio, (Number(eraserWidthInput.value) * pixelRatio) / 2);
}

function findTopPenStrokeIndexAtPoint(point, skipped = null) {
  const eraserRadius = getStrokeEraserRadius();

  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    if (skipped && skipped.has(index)) {
      continue;
    }

    const stroke = strokes[index];
    if (stroke.kind !== "pen") {
      continue;
    }

    const radius = (stroke.widthPx / 2) + eraserRadius;
    if (
      point.x < (stroke.minX - radius)
      || point.x > (stroke.maxX + radius)
      || point.y < (stroke.minY - radius)
      || point.y > (stroke.maxY + radius)
    ) {
      continue;
    }

    if (isPointNearStroke(point, stroke, radius)) {
      return index;
    }
  }

  return -1;
}

function eraseTopStrokeAtPoint(point) {
  const index = findTopPenStrokeIndexAtPoint(point);
  if (index < 0) {
    return false;
  }

  captureUndoForStrokeMutation();
  strokes.splice(index, 1);
  redrawAllStrokes();
  finalizeStrokeMutation();
  return true;
}

function eraseStrokesAlongSegment(startPoint, endPoint) {
  const distance = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
  const stepSize = Math.max(getStrokeEraserRadius() * 0.7, 1);
  const steps = Math.max(1, Math.ceil(distance / stepSize));
  const removedIndexes = new Set();

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const probe = {
      x: startPoint.x + ((endPoint.x - startPoint.x) * t),
      y: startPoint.y + ((endPoint.y - startPoint.y) * t)
    };
    const hitIndex = findTopPenStrokeIndexAtPoint(probe, removedIndexes);
    if (hitIndex >= 0) {
      removedIndexes.add(hitIndex);
    }
  }

  if (removedIndexes.size === 0) {
    return false;
  }

  captureUndoForStrokeMutation();
  const sortedIndexes = Array.from(removedIndexes).sort((a, b) => b - a);
  for (const index of sortedIndexes) {
    strokes.splice(index, 1);
  }

  redrawAllStrokes();
  finalizeStrokeMutation();
  return true;
}

function startStrokeErasing(event) {
  strokeEraserActive = true;
  strokeEraserHistoryArmed = true;
  strokeEraserPointerId = event.pointerId;
  strokeEraserLastPoint = getCanvasPoint(event);
  eraseTopStrokeAtPoint(strokeEraserLastPoint);
  canvas.setPointerCapture(event.pointerId);
  updateUndoRedoUI();
}

function continueStrokeErasing(event) {
  if (!strokeEraserActive || event.pointerId !== strokeEraserPointerId) {
    return;
  }

  const point = getCanvasPoint(event);
  eraseStrokesAlongSegment(strokeEraserLastPoint, point);
  strokeEraserLastPoint = point;
}

function stopStrokeErasing(event) {
  if (!strokeEraserActive || event.pointerId !== strokeEraserPointerId) {
    return;
  }

  strokeEraserActive = false;
  strokeEraserHistoryArmed = false;
  strokeEraserPointerId = null;
  strokeEraserLastPoint = null;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  updateUndoRedoUI();
}
