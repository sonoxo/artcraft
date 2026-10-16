import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const doctorUrl = new URL("./doctor.mjs", import.meta.url);
const doctorPath = fileURLToPath(doctorUrl);

test("help works without installing or checking toolchains", () => {
  const result = spawnSync(process.execPath, [doctorPath, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--frontend-only/);
});

test("unsupported arguments fail instead of reporting readiness", () => {
  const result = spawnSync(process.execPath, [doctorPath, "--repair"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown argument/);
});

test("toolchain probes cannot auto-install Rust and use the checkout's toolchain", { skip: process.platform === "win32" }, () => {
  const fixture = mkdtempSync(join(tmpdir(), "artcraft doctor "));
  try {
    const bin = join(fixture, "bin");
    const log = join(fixture, "probes.jsonl");
    mkdirSync(bin);
    for (const binary of ["rustc", "cargo"]) {
      writeFileSync(join(bin, binary), `#!${process.execPath}\n` +
        'const fs = require("node:fs");\n' +
        'fs.appendFileSync(process.env.PROBE_LOG, JSON.stringify({ binary: process.argv[1], cwd: process.cwd(), autoInstall: process.env.RUSTUP_AUTO_INSTALL }) + "\\n");\n' +
        'console.log("unavailable toolchain");\nprocess.exitCode = 1;\n', { mode: 0o755 });
    }
    const result = spawnSync(process.execPath, [doctorPath, "--json"], {
      cwd: fixture, encoding: "utf8",
      env: { ...process.env, PATH: bin, PROBE_LOG: log, RUSTUP_AUTO_INSTALL: "1" },
    });
    assert.equal(result.status, 1, result.stderr);
    const probes = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(probes.length, 3, "rustc, cargo, and cargo tauri must all be checked");
    for (const probe of probes) {
      assert.equal(probe.autoInstall, "0", probe.binary);
      assert.equal(probe.cwd, resolve(fileURLToPath(new URL("../..", doctorUrl))), probe.binary);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("supports the documented Nx 21 Node versions and rejects older/odd releases", async () => {
  const { supportsNode } = await loadDoctor();
  for (const [version, expected] of [
    ["v18.20.0", false], ["v20.18.3", false], ["v20.19.0", true],
    ["v21.7.0", false], ["v22.11.0", false], ["v22.12.0", true],
    ["v23.0.0", false], ["v24.0.0", true], ["invalid", false],
  ]) assert.equal(supportsNode(version), expected, version);
});

test("frontend-only readiness does not require or execute native tools", async () => {
  const { inspectPrerequisites } = await loadDoctor();
  const called = [];
  const result = inspectPrerequisites({ ...healthy(), frontendOnly: true,
    run(command, args) {
      called.push(command);
      assert.ok(["npm", "git"].includes(command), `Unexpected native check: ${command}`);
      return success("1.0.0");
    },
  });
  assert.equal(result.ready, true);
  assert.deepEqual(called, ["npm", "git"]);
});

test("a missing frontend install fails with a lockfile install remedy", async () => {
  const { inspectPrerequisites } = await loadDoctor();
  const result = inspectPrerequisites({ ...healthy(), frontendOnly: true,
    exists: (path) => !path.includes("node_modules"),
  });
  assert.equal(result.ready, false);
  assert.ok(result.checks.some((item) => item.status === "missing" && /npm ci/.test(item.fix)));
});

test("missing SQLite build metadata fails even when native commands work", async () => {
  const { inspectPrerequisites } = await loadDoctor();
  const result = inspectPrerequisites({ ...healthy(), exists: (path) => !path.endsWith(".sqlx") });
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((item) => item.id === "sqlite-metadata").status, "missing");
});

test("a broken libclang override is reported rather than silently replaced", async () => {
  const { inspectPrerequisites } = await loadDoctor();
  const result = inspectPrerequisites({ ...healthy(), env: { LIBCLANG_PATH: "/bad/llvm" },
    exists: (path) => !path.startsWith("/bad/llvm"),
  });
  assert.equal(result.ready, false);
  assert.match(result.checks.find((item) => item.id === "libclang").detail, /LIBCLANG_PATH/);
});

test("accepts an explicit libclang file and a directory with a versioned Linux library", async () => {
  const { inspectPrerequisites } = await loadDoctor();
  for (const [platform, location, filename] of [
    ["darwin", "/custom/llvm/lib/libclang.dylib", "libclang.dylib"],
    ["linux", "/custom/llvm/lib", "libclang.so.18"],
  ]) {
    const library = `/custom/llvm/lib/${filename}`;
    const report = inspectPrerequisites({ ...healthy(), platform,
      env: { LIBCLANG_PATH: location },
      exists: (path) => !path.startsWith("/custom") || path === location || path === library,
      isFile: (path) => path === library,
      listFiles: () => [filename],
    });
    assert.equal(report.checks.find((item) => item.id === "libclang").status, "ok", location);
  }
});

test("uses a caller-selected llvm-config to locate libclang", async () => {
  const { inspectPrerequisites } = await loadDoctor();
  const fixture = healthy();
  const report = inspectPrerequisites({ ...fixture, platform: "linux", env: { LLVM_CONFIG_PATH: "/custom/llvm-config" },
    exists: (path) => !/\/usr\/lib/.test(path),
    run(command, args) {
      if (command === "/custom/llvm-config") return success("/custom/llvm/lib");
      if (command === "llvm-config") return failure();
      return fixture.run(command, args);
    },
  });
  assert.equal(report.checks.find((item) => item.id === "libclang").status, "ok");
});

test("an explicitly empty libclang override fails instead of using system fallback", async () => {
  const { inspectPrerequisites } = await loadDoctor();
  const result = inspectPrerequisites({ ...healthy(), env: { LIBCLANG_PATH: "" } });
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((item) => item.id === "libclang").status, "missing");
});

test("Windows frontend readiness invokes the npm command shim through cmd.exe", async () => {
  const { inspectPrerequisites } = await loadDoctor();
  const fixture = healthy();
  const report = inspectPrerequisites({ ...fixture, platform: "win32", frontendOnly: true,
    run(command, args) {
      if (command === "npm") return failure();
      if (command === "cmd.exe") {
        assert.deepEqual(args, ["/d", "/s", "/c", "npm --version"]);
        return success("11.0.0");
      }
      return fixture.run(command, args);
    },
  });
  assert.equal(report.ready, true);
});

test("Linux WebKit absence fails readiness and names the missing dependency", async () => {
  const { inspectPrerequisites } = await loadDoctor();
  const fixture = healthy();
  const result = inspectPrerequisites({ ...fixture, platform: "linux",
    run(command, args) {
      if (command === "pkg-config" && args.includes("webkit2gtk-4.1")) return failure();
      return fixture.run(command, args);
    },
  });
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((item) => item.id === "webkit2gtk-4.1").status, "missing");
});

test("Tauri 1 is rejected and optional FFmpeg absence does not fail readiness", async () => {
  const { inspectPrerequisites } = await loadDoctor();
  const fixture = healthy();
  const optional = inspectPrerequisites({ ...fixture, run(command, args) {
    return command === "ffmpeg" ? failure() : fixture.run(command, args);
  } });
  assert.equal(optional.ready, true);
  assert.equal(optional.checks.find((item) => item.id === "ffmpeg").status, "warning");
  const oldTauri = inspectPrerequisites({ ...fixture, run(command, args) {
    return command === "cargo" && args[0] === "tauri" ? success("tauri-cli 1.8.0") : fixture.run(command, args);
  } });
  assert.equal(oldTauri.ready, false);
  assert.equal(oldTauri.checks.find((item) => item.id === "tauri").status, "missing");
});

async function loadDoctor() {
  assert.ok(existsSync(doctorPath), "The doctor command has not been implemented");
  return import(doctorUrl);
}

function healthy() {
  return {
    rootDir: "/test checkout/artcraft", platform: "darwin", arch: "arm64",
    nodeVersion: "v24.0.0", env: {}, exists: () => true, isFile: () => true, listFiles: () => [],
    run(command, args) {
      if (command === "cargo" && args[0] === "tauri") return success("tauri-cli 2.10.0");
      if (command === "brew") return success("/opt/homebrew/opt/llvm");
      if (command === "llvm-config") return success("/usr/lib/llvm/lib");
      return success("1.0.0");
    },
  };
}

function success(stdout) { return { status: 0, stdout, stderr: "" }; }
function failure() { return { status: 1, stdout: "", stderr: "unavailable" }; }
