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

export function buildPdfRectFromTopLeftAnchor(
  anchor: PdfRect,
  page: PdfPageGeometry,
  padding = 2
): NormalizedPdfRect {
  const width = clamp(anchor.width + padding * 2, 10, page.pdfWidth - anchor.x - padding);
  const height = Math.max(8, anchor.height + padding * 2);
  const x = clamp(anchor.x - padding, 0, Math.max(0, page.pdfWidth - width));
  const y = clamp(page.pdfHeight - anchor.y - anchor.height - padding, 0, Math.max(0, page.pdfHeight - height));
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

export function pdfRectToViewportRect(
  rect: Partial<PdfRect & Pick<NormalizedPdfRect, "xPct" | "yPct" | "wPct" | "hPct">>,
  page: RenderedPageGeometry
): PdfRect & { left: number; top: number } {
  const rotation = normalizeRotation(page.rotation);
  const pdfRect = denormalizePdfRect(rect, page);
  const scaleX = page.width / Math.max(1, page.pdfWidth);
  const scaleY = page.height / Math.max(1, page.pdfHeight);

  if (rotation === 90) {
    return {
      left: (page.pdfHeight - pdfRect.y - pdfRect.height) * scaleX,
      top: (page.pdfWidth - pdfRect.x - pdfRect.width) * scaleY,
      x: pdfRect.x,
      y: pdfRect.y,
      width: Math.max(22, pdfRect.height * scaleX),
      height: Math.max(16, pdfRect.width * scaleY),
    };
  }

  if (rotation === 180) {
    return {
      left: (page.pdfWidth - pdfRect.x - pdfRect.width) * scaleX,
      top: pdfRect.y * scaleY,
      x: pdfRect.x,
      y: pdfRect.y,
      width: Math.max(22, pdfRect.width * scaleX),
      height: Math.max(16, pdfRect.height * scaleY),
    };
  }

  if (rotation === 270) {
    return {
      left: pdfRect.y * scaleX,
      top: pdfRect.x * scaleY,
      x: pdfRect.x,
      y: pdfRect.y,
      width: Math.max(22, pdfRect.height * scaleX),
      height: Math.max(16, pdfRect.width * scaleY),
    };
  }

  return {
    left: pdfRect.x * scaleX,
    top: (page.pdfHeight - pdfRect.y - pdfRect.height) * scaleY,
    x: pdfRect.x,
    y: pdfRect.y,
    width: Math.max(22, pdfRect.width * scaleX),
    height: Math.max(16, pdfRect.height * scaleY),
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
