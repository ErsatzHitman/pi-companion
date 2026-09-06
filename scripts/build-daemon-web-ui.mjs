// Adapted from Paseo's `scripts/build-daemon-web-ui.mjs` (AGPL-3.0-or-later,
// Copyright (c) 2025-present Mohamed Boudra). See THIRD_PARTY_NOTICES.md and
// docs/T18-provenance.md for attribution details.
//
// Differences from the reference script:
// - source is `apps/web/dist` (this repo's DOM-first web app) instead of
//   `packages/app/dist`.
//
// T18 (Phase 1) had this script log and exit successfully when
// `apps/web/dist` did not exist yet, so `packages/server` could keep
// building before T15 landed a real web app. T43A1 (Phase 8, plan.md §13
// item 1: "Make apps/web/dist the daemon's bundled web UI in every
// packaging path") retires that leniency: apps/web now always produces a
// real build, so a missing `apps/web/dist` after the build step is a
// packaging failure, not an expected state, and this script now throws
// (matching the reference script's behavior) instead of silently packaging
// a daemon with no web UI.
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const WEB_APP_DIR = path.join(REPO_ROOT, "apps", "web");
const SOURCE_DIST = path.join(WEB_APP_DIR, "dist");
const TARGET_DIST = path.join(REPO_ROOT, "packages", "server", "dist", "server", "web-ui");
const COMPRESS_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".svg", ".map"]);

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");

function fmtMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    // On Windows, npm/npx/etc. are resolved via `.cmd` shims, which
    // `child_process.spawn` can only launch through a shell (otherwise it
    // fails with `ENOENT`). Non-Windows platforms keep `shell: false` since
    // the command is invoked directly and args do not need shell quoting.
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
        return;
      }
      resolve();
    });
  });
}

async function buildWebApp() {
  console.log("Building apps/web...");
  await run("npm", ["run", "build", "--workspace=@picompanion/web"], {
    cwd: REPO_ROOT,
  });
}

async function cleanTarget() {
  console.log(`Cleaning ${path.relative(REPO_ROOT, TARGET_DIST)}...`);
  await rm(TARGET_DIST, { recursive: true, force: true });
}

async function copyAssets() {
  await mkdir(TARGET_DIST, { recursive: true });
  console.log(`Copying assets to ${path.relative(REPO_ROOT, TARGET_DIST)}...`);
  await cp(SOURCE_DIST, TARGET_DIST, { recursive: true, force: true });
}

async function compressFile(filePath) {
  const brotliPath = `${filePath}.br`;
  const gzipPath = `${filePath}.gz`;
  await Promise.all([
    pipeline(
      createReadStream(filePath),
      createBrotliCompress({
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
        },
      }),
      createWriteStream(brotliPath),
    ),
    pipeline(createReadStream(filePath), createGzip(), createWriteStream(gzipPath)),
  ]);
}

async function precompressAssets(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const dirs = entries.filter((entry) => entry.isDirectory());

  for (const file of files) {
    const filePath = path.join(dir, file.name);
    if (COMPRESS_EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
      await compressFile(filePath);
    }
  }

  for (const subdir of dirs) {
    await precompressAssets(path.join(dir, subdir.name));
  }
}

async function measureBundle(dir) {
  let raw = 0;
  let gzip = 0;
  let brotli = 0;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const info = await stat(entryPath);
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".br") {
        brotli += info.size;
      } else if (ext === ".gz") {
        gzip += info.size;
      } else {
        raw += info.size;
      }
    }
  }

  await walk(dir);
  return { raw, gzip, brotli };
}

async function main() {
  if (!skipBuild) {
    await buildWebApp();
  }

  const sourceStat = await stat(SOURCE_DIST).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error(
      `Missing web app build at ${path.relative(REPO_ROOT, SOURCE_DIST)}. ` +
        "The daemon package requires the bundled web UI as of T43A1 " +
        "(plan.md §13 Phase 8, item 1); run " +
        "`npm run build --workspace=@picompanion/web` (or omit --skip-build " +
        "so this script builds it for you) before packaging the daemon.",
    );
  }

  await cleanTarget();
  await copyAssets();
  await precompressAssets(TARGET_DIST);

  const sizes = await measureBundle(TARGET_DIST);
  console.log("Daemon web UI bundle:");
  console.log(`  raw:    ${fmtMiB(sizes.raw)}`);
  console.log(`  gzip:   ${fmtMiB(sizes.gzip)}`);
  console.log(`  brotli: ${fmtMiB(sizes.brotli)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
