(function () {
  function validDimension(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > 20000) throw new Error("Export page dimensions are invalid or too large.");
    return number;
  }

  function pageBounds(frame, strokes, includeOutsideInk) {
    const width = validDimension(frame.width);
    const height = validDimension(frame.height);
    const bounds = { minX: 0, minY: 0, maxX: width, maxY: height };
    if (!includeOutsideInk) return bounds;
    for (const stroke of strokes || []) {
      if (!stroke || !Array.isArray(stroke.points)) continue;
      const radius = Math.max(1, Number(stroke.widthPx) || 1) / 2;
      for (const point of stroke.points) {
        const x = Number(point && point.x), y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        bounds.minX = Math.min(bounds.minX, x - radius);
        bounds.minY = Math.min(bounds.minY, y - radius);
        bounds.maxX = Math.max(bounds.maxX, x + radius);
        bounds.maxY = Math.max(bounds.maxY, y + radius);
      }
    }
    return bounds;
  }

  function sequenceFor(pages, hasPdf, includeBlankPages) {
    if (!Array.isArray(pages)) throw new Error("There are no pages to export.");
    return pages.filter((page) => page && (page.kind === "pdf" || page.kind === "blank")
      && (page.kind !== "blank" || !hasPdf || includeBlankPages));
  }

  function canvasFor(bounds, frame, strokes, drawStrokePath, background) {
    const width = Math.ceil(bounds.maxX - bounds.minX);
    const height = Math.ceil(bounds.maxY - bounds.minY);
    if (width <= 0 || height <= 0 || width > 20000 || height > 20000 || width * height > 64000000) {
      throw new Error("Export ink is too large to render safely. Remove extreme outside strokes or use a smaller page.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: !background });
    if (!context) throw new Error("Could not create an export canvas.");
    context.save();
    context.translate(-bounds.minX, -bounds.minY);
    if (background) {
      context.fillStyle = background;
      context.fillRect(bounds.minX, bounds.minY, width, height);
    }
    for (const stroke of strokes || []) drawStrokePath(stroke, context);
    context.restore();
    return canvas;
  }

  async function canvasBytes(canvas) {
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not encode exported ink.")), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  }

  function pdfPageLayout(pdfPage) {
    const media = pdfPage.getMediaBox();
    const crop = pdfPage.getCropBox();
    const left = Math.max(media.x, crop.x), bottom = Math.max(media.y, crop.y);
    const right = Math.min(media.x + media.width, crop.x + crop.width);
    const top = Math.min(media.y + media.height, crop.y + crop.height);
    const sourceWidth = validDimension(right - left), sourceHeight = validDimension(top - bottom);
    const angle = ((Number(pdfPage.getRotation().angle) % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(angle)) throw new Error("This PDF page has an unsupported rotation.");
    const swapsAxes = angle === 90 || angle === 270;
    const drawRotation = angle === 90 ? 270 : angle === 270 ? 90 : angle;
    return {
      sourceWidth, sourceHeight, rotation: angle, drawRotation,
      width: swapsAxes ? sourceHeight : sourceWidth,
      height: swapsAxes ? sourceWidth : sourceHeight,
      boundingBox: { left, bottom, right, top },
      x: angle === 180 ? sourceWidth : angle === 270 ? sourceHeight : 0,
      y: angle === 90 ? sourceWidth : angle === 180 ? sourceHeight : 0
    };
  }

  function sourcePointToVisual(x, y, layout) {
    const localX = x - layout.boundingBox.left, localY = y - layout.boundingBox.bottom;
    let pdfX, pdfY;
    if (layout.drawRotation === 90) { pdfX = layout.x - localY; pdfY = layout.y + localX; }
    else if (layout.drawRotation === 180) { pdfX = layout.x - localX; pdfY = layout.y - localY; }
    else if (layout.drawRotation === 270) { pdfX = layout.x + localY; pdfY = layout.y - localX; }
    else { pdfX = layout.x + localX; pdfY = layout.y + localY; }
    return { x: pdfX, y: layout.height - pdfY };
  }

  function framePointToVisual(x, y, frame, layout) {
    const scale = Math.min(frame.width / layout.width, frame.height / layout.height);
    const offsetX = (frame.width - layout.width * scale) / 2;
    const offsetY = (frame.height - layout.height * scale) / 2;
    return { x: (x - offsetX) / scale, y: (y - offsetY) / scale };
  }

  function hasPageContents(sourcePage) {
    const contents = sourcePage.node.normalizedEntries().Contents;
    return Boolean(contents && (!contents.size || contents.size() > 0));
  }

  async function drawOriginalPage(output, targetPage, sourcePage, layout, PDFLib, x, y) {
    if (!hasPageContents(sourcePage)) return;
    const [embedded] = await output.embedPages(new Array(sourcePage), new Array(layout.boundingBox));
    targetPage.drawPage(embedded, { x, y, width: layout.sourceWidth, height: layout.sourceHeight, rotate: PDFLib.degrees(layout.drawRotation) });
  }

  function blankDimensions(blankSize) {
    const frameWidth = validDimension(blankSize && blankSize.width);
    const frameHeight = validDimension(blankSize && blankSize.height);
    const aspect = frameWidth / frameHeight;
    const longSide = 841.89;
    return aspect >= 1
      ? { width: longSide, height: longSide / aspect, frameWidth, frameHeight }
      : { width: longSide * aspect, height: longSide, frameWidth, frameHeight };
  }

  async function exportSequence(options) {
    const { PDFLib, pdfBytes, pages, drawStrokePath } = options || {};
    if (!PDFLib || !PDFLib.PDFDocument || typeof drawStrokePath !== "function") throw new Error("PDF export is unavailable in this build.");
    if (pdfBytes && !(pdfBytes instanceof Uint8Array) && !(pdfBytes instanceof ArrayBuffer)) throw new Error("The original PDF data is invalid.");
    const source = pdfBytes ? await PDFLib.PDFDocument.load(pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes)) : null;
    const hasPdf = Boolean(source);
    const sequence = sequenceFor(pages, hasPdf, Boolean(options.includeBlankPages));
    if (!sequence.length) throw new Error("There are no pages to export.");
    const output = await PDFLib.PDFDocument.create();
    const sourcePages = source ? source.getPages() : [];
    for (const entry of sequence) {
      if (entry.kind === "blank") {
        const blankWorldSize = entry.worldSize;
        if (!blankWorldSize) throw new Error("This blank page has no saved drawing frame. Reopen the work file and try again.");
        const blankFrame = blankDimensions(blankWorldSize);
        const frame = { width: blankFrame.frameWidth, height: blankFrame.frameHeight };
        const bounds = pageBounds(frame, entry.strokes, true);
        const scaleX = blankFrame.width / frame.width, scaleY = blankFrame.height / frame.height;
        const page = output.addPage(new Array((bounds.maxX - bounds.minX) * scaleX, (bounds.maxY - bounds.minY) * scaleY));
        const canvas = canvasFor(bounds, frame, entry.strokes, drawStrokePath, entry.background || "#ffffff");
        const image = await output.embedPng(await canvasBytes(canvas));
        page.drawImage(image, {
          x: 0, y: 0,
          width: (bounds.maxX - bounds.minX) * scaleX,
          height: (bounds.maxY - bounds.minY) * scaleY
        });
        continue;
      }

      const pageIndex = Math.floor(Number(entry.pdfPage)) - 1;
      const sourcePage = sourcePages[pageIndex];
      if (!sourcePage) throw new Error(`PDF page ${entry.pdfPage} is missing from the original file.`);
      const dimensions = pdfPageLayout(sourcePage);
      const strokes = Array.isArray(entry.strokes) ? entry.strokes : [];
      if (!strokes.length) {
        const [copiedPage] = await output.copyPages(source, new Array(1).fill(pageIndex));
        output.addPage(copiedPage);
        continue;
      }
      const frame = entry.pdfWorldSize && {
        width: validDimension(entry.pdfWorldSize.width), height: validDimension(entry.pdfWorldSize.height)
      };
      if (!frame && strokes.length) throw new Error(`PDF page ${entry.pdfPage} has no saved drawing frame. Reopen the page and try again.`);
      if (!frame) throw new Error(`PDF page ${entry.pdfPage} has no saved drawing frame. Reopen the page and try again.`);
      const renderScale = Math.min(frame.width / dimensions.width, frame.height / dimensions.height);
      const offsetX = (frame.width - dimensions.width * renderScale) / 2;
      const offsetY = (frame.height - dimensions.height * renderScale) / 2;
      const bounds = pageBounds(frame, entry.strokes, Boolean(options.includeOutsideInk));
      const includeOutsideInk = Boolean(options.includeOutsideInk);
      const frameMinPdfY = dimensions.height - (bounds.maxY - offsetY) / renderScale;
      const frameMaxPdfY = dimensions.height - (bounds.minY - offsetY) / renderScale;
      const pageMinX = includeOutsideInk ? Math.min(0, (bounds.minX - offsetX) / renderScale) : 0;
      const pageMinY = includeOutsideInk ? Math.min(0, frameMinPdfY) : 0;
      const pageMaxX = includeOutsideInk ? Math.max(dimensions.width, (bounds.maxX - offsetX) / renderScale) : dimensions.width;
      const pageMaxY = includeOutsideInk ? Math.max(dimensions.height, frameMaxPdfY) : dimensions.height;
      const pageWidth = pageMaxX - pageMinX, pageHeight = pageMaxY - pageMinY;
      if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight)) throw new Error("PDF export produced invalid page bounds.");
      const page = output.addPage(new Array(pageWidth, pageHeight));
      await drawOriginalPage(output, page, sourcePage, dimensions, PDFLib, dimensions.x - pageMinX, dimensions.y - pageMinY);

      if (entry.strokes && entry.strokes.length) {
        const canvas = canvasFor(bounds, frame, entry.strokes, drawStrokePath, null);
        const image = await output.embedPng(await canvasBytes(canvas));
        const imageX = (bounds.minX - offsetX) / renderScale - pageMinX;
        const imageY = frameMinPdfY - pageMinY;
        page.drawImage(image, { x: imageX, y: imageY, width: (bounds.maxX - bounds.minX) / renderScale, height: (bounds.maxY - bounds.minY) / renderScale });
      }
    }
    return output.save();
  }

  window.BoardExport = { exportSequence, pageBounds, sequenceFor, pdfPageLayout, sourcePointToVisual, framePointToVisual };
})();
