import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";

const backend = resolve(process.env.NEMLAB_BACKEND ?? "../nemlab");
const files = ["openapi.json", "generated/schema.d.ts"];
const digest = (data) => createHash("sha256").update(data).digest("hex");
const sync = process.argv.includes("--sync");
const required = process.argv.includes("--backend") || sync;
let available = true;
try {
  await access(`${backend}/api/contracts/openapi.json`);
} catch {
  available = false;
}
assert(!required || available, "Backend checkout required; set NEMLAB_BACKEND");
if (sync) {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: backend,
    encoding: "utf8",
  }).trim();
  const hashes = {};
  for (const file of files) {
    const source = await readFile(`${backend}/api/contracts/${file}`);
    const committed = execFileSync("git", ["show", `${commit}:api/contracts/${file}`], {
      cwd: backend,
    });
    assert(source.equals(committed), `Commit backend contract changes before importing ${file}`);
    await mkdir("contracts/generated", { recursive: true });
    await writeFile(`contracts/${file}`, source);
    hashes[file] = digest(source);
  }
  const spec = JSON.parse(await readFile("contracts/openapi.json", "utf8"));
  await writeFile(
    "contracts/provenance.json",
    JSON.stringify({ backendCommit: commit, version: spec.info.version, sha256: hashes }, null, 2) +
      "\n",
  );
}
const manifest = JSON.parse(await readFile("contracts/provenance.json", "utf8"));
for (const file of files) {
  const local = await readFile(`contracts/${file}`);
  assert.equal(digest(local), manifest.sha256[file], `Imported contract changed: ${file}`);
  if (available) {
    assert(
      local.equals(await readFile(`${backend}/api/contracts/${file}`)),
      `Backend contract drift: ${file}; review and sync`,
    );
  }
}
console.log(
  `Contract ${manifest.version} verified (${available ? "backend compared" : "snapshot only; backend unavailable"}).`,
);
