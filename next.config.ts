import type { NextConfig } from "next";

// Assets the scanned-PDF OCR fallback needs bundled into the upload functions so
// a cold serverless instance never fetches the language data / wasm core from a
// CDN: the vendored English traineddata, the tesseract.js-core wasm, the
// tesseract.js node worker, and the pdf.js renderer.
const OCR_TRACE_INCLUDES = [
  "./assets/tessdata/eng.traineddata.gz",
  "./node_modules/tesseract.js-core/**",
  "./node_modules/tesseract.js/**",
  // tesseract.js is a serverExternalPackage, so nft never walks its imports —
  // and "tesseract.js/**" does NOT cover its HOISTED runtime dependencies in
  // top-level node_modules. The node worker requires these at runtime
  // (worker-script/utils/setImage.js line 3 is `require('bmp-js')`); missing
  // ones crash /api/upload with an uncaught MODULE_NOT_FOUND on scanned PDFs.
  "./node_modules/bmp-js/**",
  "./node_modules/idb-keyval/**",
  "./node_modules/is-url/**",
  "./node_modules/node-fetch/**",
  "./node_modules/regenerator-runtime/**",
  "./node_modules/wasm-feature-detect/**",
  "./node_modules/zlibjs/**",
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
      // The forensic report masthead reads the wordmark from disk. Files under
      // public/ are served as static assets but are NOT traced into a function
      // bundle, so without this the deployed report falls back to the typeset
      // mark while local runs show the logo — a difference nobody would catch.
      "./public/iq/iq_logo.png",
    ],
    "/api/reports/oem-citation-density/annotated-estimate": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./public/iq/iq_logo.png",
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
