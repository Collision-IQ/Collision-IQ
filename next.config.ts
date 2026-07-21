import type { NextConfig } from "next";

// Assets the scanned-PDF OCR fallback needs bundled into the upload functions so
// a cold serverless instance never fetches the language data / wasm core from a
// CDN: the vendored English traineddata, the tesseract.js-core wasm, the
// tesseract.js node worker, and the pdf.js renderer.
const OCR_TRACE_INCLUDES = [
  "./assets/tessdata/eng.traineddata.gz",
  "./node_modules/tesseract.js-core/**",
  "./node_modules/tesseract.js/**",
  "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  // pdf.js imports the worker module at runtime even with disableWorker
  // ("fake worker") — without it OCR fails on Vercel with "Cannot find module
  // '...pdf.worker.mjs' imported from '...pdf.mjs'".
  "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      // Marketing ROI calculator (standalone static page in /public); campaign
      // UTM links point at /roi — see marketing/UTM_CONVENTIONS.md.
      { source: "/roi", destination: "/roi_calculator.html" },
    ];
  },
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "tesseract.js", "tesseract.js-core"],
  outputFileTracingIncludes: {
    "/api/reports/citation-density/annotated-estimate": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
    ],
    "/api/upload": OCR_TRACE_INCLUDES,
    "/api/upload/finalize": OCR_TRACE_INCLUDES,
    // Scan IQ extracts uploaded scan PDFs with the same OCR fallback — without
    // these assets a deployed instance silently fails OCR and reports every
    // image-only scan PDF as "no readable scan text".
    "/api/scan-iq": OCR_TRACE_INCLUDES,
  },
};

export default nextConfig
