import yazl from "yazl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.dirname(fileURLToPath(import.meta.url));

// Fixed entry timestamp so regenerating the fixtures is byte-identical. The
// Date is built from local-time fields and only the DOS timestamp is written
// (no UT extra field), so the encoded bytes do not depend on the clock or TZ.
const ENTRY_OPTIONS = { mtime: new Date(2026, 0, 1, 0, 0, 0), forceDosTimestamp: true };

function write(name, zipfile) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(path.join(OUT, name));
    out.on("finish", resolve);
    out.on("error", reject);
    zipfile.outputStream.pipe(out);
    zipfile.end();
  });
}

async function buildValid() {
  const z = new yazl.ZipFile();
  z.addBuffer(Buffer.from("%PDF-1.4\n%fake pdf body\n%%EOF\n"), "estimate.pdf", ENTRY_OPTIONS);
  z.addBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]), "photo.jpg", ENTRY_OPTIONS);
  await write("valid.zip", z);
}

async function buildZipSlip() {
  const z = new yazl.ZipFile();
  const safeName = "safe/safe/passwdxxx";
  const unsafeName = "../../../etc/passwd";
  z.addBuffer(Buffer.from("payload"), safeName, ENTRY_OPTIONS);
  await write("zip-slip.zip", z);

  const target = path.join(OUT, "zip-slip.zip");
  const buf = fs.readFileSync(target);
  const safe = Buffer.from(safeName);
  const unsafe = Buffer.from(unsafeName);
  for (let i = 0; i <= buf.length - safe.length; i += 1) {
    if (buf.subarray(i, i + safe.length).equals(safe)) {
      unsafe.copy(buf, i);
    }
  }
  fs.writeFileSync(target, buf);
}

// One entry past the admin plan's maxExtractedFiles (ADMIN_UPLOAD_BATCH_FILE_LIMIT
// = 1000 in src/lib/uploadSafety/uploadLimits.ts; the route test runs as admin).
// Entries are a ZIP-allowed type, so the entry-count cap is the only guard that
// can reject the archive.
const TOO_MANY_ENTRIES = 1001;

async function buildTooMany() {
  const z = new yazl.ZipFile();
  for (let i = 0; i < TOO_MANY_ENTRIES; i += 1) {
    z.addBuffer(Buffer.from(`%PDF-1.4\n%entry ${i}\n%%EOF\n`), `f${i}.pdf`, ENTRY_OPTIONS);
  }
  await write("too-many-entries.zip", z);
}

async function buildEncrypted() {
  const z = new yazl.ZipFile();
  z.addBuffer(Buffer.from("placeholder content"), "secret.txt", ENTRY_OPTIONS);
  const tmp = path.join(OUT, ".encrypted-pre.zip");
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    out.on("finish", resolve);
    out.on("error", reject);
    z.outputStream.pipe(out);
    z.end();
  });
  const buf = fs.readFileSync(tmp);

  for (let i = 0; i < buf.length - 4; i += 1) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      buf[i + 6] |= 0x01;
    }
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
      buf[i + 8] |= 0x01;
    }
  }

  fs.writeFileSync(path.join(OUT, "encrypted.zip"), buf);
  fs.unlinkSync(tmp);
}

await buildValid();
await buildZipSlip();
await buildTooMany();
await buildEncrypted();
console.log("zip fixtures written to", OUT);
