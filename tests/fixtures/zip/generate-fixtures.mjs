import yazl from "yazl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.dirname(fileURLToPath(import.meta.url));

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
  z.addBuffer(Buffer.from("%PDF-1.4\n%fake pdf body\n%%EOF\n"), "estimate.pdf");
  z.addBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]), "photo.jpg");
  await write("valid.zip", z);
}

async function buildZipSlip() {
  const z = new yazl.ZipFile();
  const safeName = "safe/safe/passwdxxx";
  const unsafeName = "../../../etc/passwd";
  z.addBuffer(Buffer.from("payload"), safeName);
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

async function buildTooMany() {
  const z = new yazl.ZipFile();
  for (let i = 0; i < 60; i += 1) {
    z.addBuffer(Buffer.from(`entry ${i}`), `f${i}.txt`);
  }
  await write("too-many-entries.zip", z);
}

async function buildEncrypted() {
  const z = new yazl.ZipFile();
  z.addBuffer(Buffer.from("placeholder content"), "secret.txt");
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
