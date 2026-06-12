export type PdfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfPageGeometry = {
  pdfWidth: number;
  pdfHeight: number;
  rotation?: number;
};

export type RenderedPageGeometry = PdfPageGeometry & {
  width: number;
  height: number;
};

export type NormalizedPdfRect = PdfRect & {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
};

// Citation Density stores row boxes in top-left PDF page coordinates. Convert
// to pdf-lib's bottom-left coordinate system only at PDF draw/annotation time.
export function buildPdfRectFromTopLeftAnchor(
  anchor: PdfRect,
  page: PdfPageGeometry,
  padding = 2
): NormalizedPdfRect {
  const width = clamp(anchor.width + padding * 2, 10, page.pdfWidth - anchor.x - padding);
  const height = Math.max(8, anchor.height + padding * 2);
  const x = clamp(anchor.x - padding, 0, Math.max(0, page.pdfWidth - width));
  const y = clamp(anchor.y - padding, 0, Math.max(0, page.pdfHeight - height));
  return normalizePdfRect({ x, y, width, height }, page);
}

export function normalizePdfRect(rect: PdfRect, page: PdfPageGeometry): NormalizedPdfRect {
  return {
    x: roundCoordinate(rect.x),
    y: roundCoordinate(rect.y),
    width: roundCoordinate(rect.width),
    height: roundCoordinate(rect.height),
    xPct: roundRatio(rect.x / Math.max(1, page.pdfWidth)),
    yPct: roundRatio(rect.y / Math.max(1, page.pdfHeight)),
    wPct: roundRatio(rect.width / Math.max(1, page.pdfWidth)),
    hPct: roundRatio(rect.height / Math.max(1, page.pdfHeight)),
  };
}

export function denormalizePdfRect(
  rect: Partial<PdfRect & Pick<NormalizedPdfRect, "xPct" | "yPct" | "wPct" | "hPct">>,
  page: PdfPageGeometry
): PdfRect {
  if (
    typeof rect.xPct === "number" &&
    typeof rect.yPct === "number" &&
    typeof rect.wPct === "number" &&
    typeof rect.hPct === "number"
  ) {
    return {
      x: rect.xPct * page.pdfWidth,
      y: rect.yPct * page.pdfHeight,
      width: rect.wPct * page.pdfWidth,
      height: rect.hPct * page.pdfHeight,
    };
  }

  return {
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
  };
}

export function topLeftRectToPdfLibRect(
  rect: Partial<PdfRect & Pick<NormalizedPdfRect, "xPct" | "yPct" | "wPct" | "hPct">>,
  page: PdfPageGeometry
): PdfRect {
  const topLeftRect = denormalizePdfRect(rect, page);
  return {
    x: topLeftRect.x,
    y: clamp(page.pdfHeight - topLeftRect.y - topLeftRect.height, 0, Math.max(0, page.pdfHeight - topLeftRect.height)),
    width: topLeftRect.width,
    height: topLeftRect.height,
  };
}

export function pdfRectToViewportRect(
  rect: Partial<PdfRect & Pick<NormalizedPdfRect, "xPct" | "yPct" | "wPct" | "hPct">>,
  page: RenderedPageGeometry
): PdfRect & { left: number; top: number } {
  const rotation = normalizeRotation(page.rotation);
  const topLeftRect = denormalizePdfRect(rect, page);
  const scaleX = page.width / Math.max(1, page.pdfWidth);
  const scaleY = page.height / Math.max(1, page.pdfHeight);

  if (rotation === 90) {
    return {
      left: topLeftRect.y * scaleX,
      top: (page.pdfWidth - topLeftRect.x - topLeftRect.width) * scaleY,
      x: topLeftRect.x,
      y: topLeftRect.y,
      width: Math.max(22, topLeftRect.height * scaleX),
      height: Math.max(16, topLeftRect.width * scaleY),
    };
  }

  if (rotation === 180) {
    return {
      left: (page.pdfWidth - topLeftRect.x - topLeftRect.width) * scaleX,
      top: (page.pdfHeight - topLeftRect.y - topLeftRect.height) * scaleY,
      x: topLeftRect.x,
      y: topLeftRect.y,
      width: Math.max(22, topLeftRect.width * scaleX),
      height: Math.max(16, topLeftRect.height * scaleY),
    };
  }

  if (rotation === 270) {
    return {
      left: (page.pdfHeight - topLeftRect.y - topLeftRect.height) * scaleX,
      top: topLeftRect.x * scaleY,
      x: topLeftRect.x,
      y: topLeftRect.y,
      width: Math.max(22, topLeftRect.height * scaleX),
      height: Math.max(16, topLeftRect.width * scaleY),
    };
  }

  return {
    left: topLeftRect.x * scaleX,
    top: topLeftRect.y * scaleY,
    x: topLeftRect.x,
    y: topLeftRect.y,
    width: Math.max(22, topLeftRect.width * scaleX),
    height: Math.max(16, topLeftRect.height * scaleY),
  };
}

export function normalizeRotation(value: number | undefined): 0 | 90 | 180 | 270 {
  const normalized = (((value ?? 0) % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

export function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

export function roundRatio(value: number) {
  return Math.round(value * 1000000) / 1000000;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
