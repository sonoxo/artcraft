#!/usr/bin/env node
// Read-only build diagnostics. Never installs packages or contacts model providers.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NODE_FIX = "Use Node.js 24 LTS (also supported: 22.12+ within 22.x, 20.19+ within 20.x).";
const LINUX_FIX = "See _docs/dev_setup.md for your distribution's compiler, WebKitGTK, GTK, LLVM and ALSA packages.";

export function inspectPrerequisites({
  rootDir = ROOT_DIR,
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.version,
  env = process.env,
  frontendOnly = false,
  run = runCommand,
  exists = existsSync,
  isFile = isRegularFile,
  listFiles = listDirectory,
} = {}) {
  const checks = [];
  const add = (id, ok, detail, fix = "", optional = false) => checks.push({
    id, status: ok ? "ok" : optional ? "warning" : "missing", detail, fix: ok ? "" : fix,
  });
  const command = (id, binary, args, fix, optional = false) => {
    const result = run(binary, args);
    add(id, result.status === 0, result.status === 0
      ? `${binary}: ${(result.stdout || result.stderr || "available").trim().split("\n")[0]}`
      : `${binary} is missing or could not run.`, fix, optional);
    return result;
  };
  const frontend = join(rootDir, "frontend");

  add("node", supportsNode(nodeVersion), `Node.js ${nodeVersion}`, NODE_FIX);
  command("npm", platform === "win32" ? "cmd.exe" : "npm",
    platform === "win32" ? ["/d", "/s", "/c", "npm --version"] : ["--version"],
    "Install npm with Node.js 24 LTS.");
  command("git", "git", ["--version"], "Install Git; some locked frontend packages are fetched from GitHub.");
  add("frontend-lock", exists(join(frontend, "package-lock.json")), "Frontend dependency lockfile",
    "Restore frontend/package-lock.json from this repository.");
  for (const [name, path] of [
    ["nx", "nx/bin/nx.js"], ["vite", "vite/bin/vite.js"], ["vitest", "vitest/vitest.mjs"],
  ]) add(`frontend-${name}`, exists(join(frontend, "node_modules", path)), `Local ${name} installation`,
    "Run npm ci from the frontend directory.");

  if (!frontendOnly) {
    add("cargo-lock", exists(join(rootDir, "Cargo.lock")), "Rust dependency lockfile",
      "Restore Cargo.lock from this repository.");
    add("sqlite-metadata", exists(join(rootDir, ".sqlx")), "Offline SQLite query metadata",
      "Restore the tracked .sqlx directory; use SQLX_OFFLINE=true for builds.");
    add("sqlite-migrations", exists(join(rootDir, "_database/sql/artcraft_migrations")), "Embedded SQLite migrations",
      "Restore _database/sql/artcraft_migrations from this repository.");
    command("rustc", "rustc", ["--version"], "Install a stable Rust toolchain: https://rustup.rs");
    command("cargo", "cargo", ["--version"], "Install a stable Rust toolchain: https://rustup.rs");
    const tauri = run("cargo", ["tauri", "--version"]);
    add("tauri", tauri.status === 0 && /tauri(?:-cli)?\s+2\./.test(tauri.stdout || ""), "Cargo Tauri CLI v2",
      'Run cargo install tauri-cli --version "^2" --locked.');
    command("cmake", "cmake", ["--version"], platform === "darwin" ? "Run brew install cmake." : LINUX_FIX);
    command("pkg-config", "pkg-config", ["--version"], platform === "darwin" ? "Run brew install pkg-config." : LINUX_FIX);

    if (platform === "darwin") {
      command("xcode-tools", "xcode-select", ["-p"], "Run xcode-select --install, finish Apple's installer, then rerun setup.");
      command("c-compiler", "xcrun", ["clang", "--version"], "Install/select Xcode Command Line Tools.");
    } else if (platform === "linux") {
      command("c-compiler", "cc", ["--version"], LINUX_FIX);
      command("cxx-compiler", "c++", ["--version"], LINUX_FIX);
      for (const name of ["gtk+-3.0", "webkit2gtk-4.1", "ayatana-appindicator3-0.1", "librsvg-2.0", "openssl", "alsa"]) {
        const result = run("pkg-config", ["--exists", name]);
        add(name, result.status === 0, `${name} development libraries`, LINUX_FIX);
      }
    } else {
      add("native-platform", false, `Native prerequisite checks are implemented for macOS and Linux (${platform} detected).`,
        "Use --frontend-only for frontend checks; follow Tauri's Windows prerequisites for a native Windows build.");
    }

    const libraryName = platform === "darwin" ? "libclang.dylib" : "libclang.so";
    const libraryPattern = platform === "darwin" ? /^libclang(?:[.-][\d.]+)?\.dylib$/ : /^libclang(?:-[\d.]+)?\.so(?:\.[\d.]+)?$/;
    const hasLibrary = (location) => {
      if (!location || !exists(location)) return false;
      if (libraryPattern.test(basename(location)) && isFile(location)) return true;
      return [libraryName, ...listFiles(location)].some((name) => libraryPattern.test(name)
        && exists(join(location, name)) && isFile(join(location, name)));
    };
    if (env.LIBCLANG_PATH !== undefined) {
      add("libclang", hasLibrary(env.LIBCLANG_PATH), "libclang selected by LIBCLANG_PATH",
        `Set LIBCLANG_PATH to a ${libraryName} file or containing directory, or unset the override.`);
    } else {
      const llvm = run(env.LLVM_CONFIG_PATH ?? "llvm-config", ["--libdir"]);
      let llvmDir = llvm.status === 0 ? llvm.stdout.trim() : "";
      if (!llvmDir && platform === "darwin") {
        const brew = run("brew", ["--prefix", "llvm"]);
        if (brew.status === 0 && brew.stdout.trim()) llvmDir = join(brew.stdout.trim(), "lib");
      }
      const candidates = [
        ...(llvmDir ? [llvmDir] : []),
        ...(platform === "linux" ? ["/usr/lib", "/usr/lib64", "/usr/lib/x86_64-linux-gnu",
          ...[22, 21, 20, 19, 18, 17, 16].map((version) => `/usr/lib/llvm-${version}/lib`)] : []),
      ];
      add("libclang", candidates.some(hasLibrary), "libclang for Rust bindgen",
        platform === "darwin" ? 'Run brew install llvm; export LIBCLANG_PATH="$(brew --prefix llvm)/lib".' :
          "Install libclang-dev (or your distribution's LLVM development package) and set LIBCLANG_PATH if needed.");
    }
    command("ffmpeg", "ffmpeg", ["-version"], "Optional: install ffmpeg for video playback in artcraft_native.", true);
  }

  return { schema_version: 1, platform, arch, scope: frontendOnly ? "frontend" : "desktop",
    ready: checks.every((item) => item.status !== "missing"), checks };
}

export function supportsNode(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major === 24;
}

function main(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node script/artcraft/doctor.mjs [--frontend-only] [--json]\n\nChecks build prerequisites without installing packages or making provider requests.\nExit codes: 0 ready, 1 missing prerequisites, 2 invalid arguments.");
    return;
  }
  const unknown = args.find((arg) => !["--json", "--frontend-only"].includes(arg));
  if (unknown) {
    console.error(`Unknown argument: ${unknown} (see --help)`);
    process.exitCode = 2;
    return;
  }
  const report = inspectPrerequisites({ frontendOnly: args.includes("--frontend-only") });
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`ArtCraft build doctor — ${report.platform}/${report.arch} (${report.scope})`);
    for (const item of report.checks) {
      console.log(`[${item.status.toUpperCase()}] ${item.detail}`);
      if (item.fix) console.log(`  ${item.fix}`);
    }
    console.log(report.ready ? "Build prerequisites are present. Run the build to verify compilation." : "Resolve the missing prerequisites, then rerun this check.");
  }
  process.exitCode = report.ready ? 0 : 1;
}

function runCommand(command, args) {
  return spawnSync(command, args, {
    cwd: ROOT_DIR,
    env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" },
    encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
  });
}

function isRegularFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

function listDirectory(path) {
  try { return readdirSync(path); } catch { return []; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2));
