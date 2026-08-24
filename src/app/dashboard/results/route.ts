import { issueSignedToken, presignUrl, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthorizedError } from "@/lib/auth/require-current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only results ledger (appraisal awards / DV / total-loss outcomes).
 *
 * The ledger is a standalone HTML document that intentionally lives in the
 * PRIVATE blob store, never in the repository: the repo is public on GitHub,
 * and the owner decided this data must not be published (see the scrapped
 * /results static page). GET serves the stored document to platform admins;
 * POST lets an admin upload a new revision, so refreshing the numbers never
 * requires a deploy. Everyone who is not a platform admin gets a 404, the
 * same shape as a route that does not exist.
 */

const LEDGER_PATHNAME = "internal/results-ledger.html";
const MAX_LEDGER_BYTES = 2 * 1024 * 1024;

async function requirePlatformAdmin() {
  try {
    const { isPlatformAdmin } = await requireCurrentUser();
    return isPlatformAdmin;
  } catch (error) {
    if (error instanceof UnauthorizedError) return false;
    throw error;
  }
}

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

function htmlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

const UPLOAD_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Results Ledger — upload</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141A21;color:#E6EBF1;font-family:system-ui,sans-serif}
  .card{max-width:30rem;padding:2rem;border:1px solid #2E3842;border-radius:12px;background:#1C242D}
  h1{margin:0 0 .5rem;font-size:1.25rem}
  p{margin:.25rem 0 1rem;color:#96A1AE;font-size:.9rem;line-height:1.5}
  input[type=file]{margin-bottom:1rem}
  button{padding:.5rem 1.25rem;border:0;border-radius:8px;background:#D9662B;color:#fff;font-weight:600;cursor:pointer}
  #msg{margin-top:1rem;font-size:.9rem}
</style>
</head>
<body>
<div class="card">
  <h1>Results Ledger</h1>
  <p>No ledger is stored yet, or you are replacing it. Choose the compiled
  <code>results.html</code> file and upload — it is stored in the private blob
  store and shown only to platform admins.</p>
  <input type="file" id="f" accept=".html,text/html">
  <button id="go">Upload ledger</button>
  <div id="msg"></div>
</div>
<script>
document.getElementById('go').addEventListener('click', async () => {
  const f = document.getElementById('f').files[0];
  const msg = document.getElementById('msg');
  if (!f) { msg.textContent = 'Choose a file first.'; return; }
  msg.textContent = 'Uploading…';
  const res = await fetch(location.pathname, { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: f });
  if (res.ok) { msg.textContent = 'Stored. Opening…'; location.reload(); }
  else { msg.textContent = 'Upload failed: ' + (await res.text()); }
});
</script>
</body>
</html>`;

async function fetchStoredLedger(): Promise<string | null> {
  const signedToken = await issueSignedToken({
    pathname: LEDGER_PATHNAME,
    operations: ["get"],
    validUntil: Date.now() + 5 * 60 * 1000,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "get",
    pathname: LEDGER_PATHNAME,
    access: "private",
  });
  const res = await fetch(presignedUrl);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Ledger blob fetch failed with ${res.status}`);
  return res.text();
}

export async function GET(req: Request) {
  if (!(await requirePlatformAdmin())) return notFound();

  const wantsUploadForm = new URL(req.url).searchParams.has("upload");
  if (!wantsUploadForm) {
    const stored = await fetchStoredLedger();
    if (stored !== null) return htmlResponse(stored);
  }
  return htmlResponse(UPLOAD_PAGE);
}

export async function POST(req: Request) {
  if (!(await requirePlatformAdmin())) return notFound();

  const body = await req.text();
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes === 0 || bytes > MAX_LEDGER_BYTES) {
    return new NextResponse(`Ledger must be 1 byte to ${MAX_LEDGER_BYTES} bytes; got ${bytes}.`, { status: 400 });
  }
  if (!/^\s*<!doctype html>/i.test(body)) {
    return new NextResponse("File does not look like the compiled ledger (missing <!doctype html>).", { status: 400 });
  }

  await put(LEDGER_PATHNAME, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/html; charset=utf-8",
    cacheControlMaxAge: 0,
  });
  return NextResponse.json({ ok: true, pathname: LEDGER_PATHNAME, bytes });
}
