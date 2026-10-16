// Run from any directory: node --test script/artcraft/unix_scripts.test.mjs
// Exercise the real shell scripts in disposable checkouts. npm, Cargo, and Nx
// are executable boundary doubles: these tests must not install or build an app.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../../", import.meta.url));
const frontendScripts = [
  ["unix_frontend_dev.sh", "dev"],
  ["unix_frontend_production_build.sh", "build"],
  ["unix_frontend_production_preview.sh", "production-preview"],
];
const nativeScripts = [
  ["unix_build.sh", "build", "tauri.conf.json"],
  ["unix_rust_dev.sh", "dev", "tauri-dev-hot-reload.conf.json"],
  ["unix_rust_production_javascript_preview.sh", "dev", "tauri-dev-static.conf.json"],
];
const environmentKeys = [
  "VITE_ENVIRONMENT_TYPE", "SQLX_OFFLINE", "RUSTFLAGS",
  "WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DISABLE_COMPOSITING_MODE",
  "TAURI_APP_PATH", "TAURI_FRONTEND_PATH",
];

for (const [script, target] of frontendScripts) {
  test(`${script} uses its checkout and local Nx from an unrelated directory`, async (t) => {
    const f = await fixture(t);
    const result = f.run(script, ["--configuration", "a value with spaces"]);
    assert.equal(result.status, 0, result.output);
    const events = await f.events();
    assert.deepEqual(events.find((event) => event.command === "npm").args, ["ci"]);
    const nx = events.find((event) => event.command === "local-nx");
    assert.ok(nx, "must use the Nx executable in this checkout");
    assert.equal(nx.cwd, f.frontend);
    assert.deepEqual(nx.args.slice(0, 2), [target, "artcraft"]);
    assert.deepEqual(nx.args.slice(-2), ["--configuration", "a value with spaces"]);
    assert.equal(nx.env.VITE_ENVIRONMENT_TYPE, "production");
    assert.ok(!events.some((event) => event.command === "global-nx"));
    assert.ok(!events.some((event) => event.command === "lsof"), "must leave existing listeners alone");
    if (target !== "build") assert.ok(nx.args.includes("--strictPort"));
  });

  test(`${script} propagates the Nx failure`, async (t) => {
    const f = await fixture(t);
    const result = f.run(script, [], { cwd: f.root, env: { ARTCRAFT_SCRIPT_TEST_NX_EXIT: "39" } });
    assert.equal(result.status, 39, result.output);
  });

  test(`${script} preserves an explicitly empty environment override`, async (t) => {
    const f = await fixture(t);
    const result = f.run(script, [], { env: { VITE_ENVIRONMENT_TYPE: "" } });
    assert.equal(result.status, 0, result.output);
    assert.equal((await f.events()).find((event) => event.command === "local-nx").env.VITE_ENVIRONMENT_TYPE, "");
  });
}

for (const [script, command, config] of nativeScripts) {
  test(`${script} runs Cargo from its checkout and forwards arguments intact`, async (t) => {
    const f = await fixture(t);
    const args = command === "build" ? ["--no-bundle", "--config", "a path with spaces.json"] : ["--features", "a-test-feature"];
    const result = f.run(script, args);
    assert.equal(result.status, 0, result.output);
    const cargo = (await f.events()).find((event) => event.command === "cargo" && !event.args.includes("--version"));
    assert.equal(cargo.cwd, f.root);
    assert.deepEqual(cargo.args.slice(0, 2), ["tauri", command]);
    assert.equal(cargo.args[cargo.args.indexOf("--config") + 1], path.join(f.rust, config));
    assert.deepEqual(cargo.args.slice(-args.length), args);
    assert.equal(cargo.env.SQLX_OFFLINE, "true");
    assert.equal(cargo.env.TAURI_APP_PATH, f.rust);
    assert.equal(cargo.env.TAURI_FRONTEND_PATH, f.frontend);
    if (command === "build") assert.equal(cargo.path.split(path.delimiter)[0], path.join(f.frontend, "node_modules/.bin"));
  });

  test(`${script} preserves caller configuration and Cargo failure status`, async (t) => {
    const f = await fixture(t);
    const overrides = {
      VITE_ENVIRONMENT_TYPE: "staging", SQLX_OFFLINE: "false", RUSTFLAGS: "-C debuginfo=1",
      WEBKIT_DISABLE_DMABUF_RENDERER: "0", WEBKIT_DISABLE_COMPOSITING_MODE: "",
    };
    const result = f.run(script, [], { cwd: f.root, env: { ...overrides, ARTCRAFT_SCRIPT_TEST_CARGO_EXIT: "47" } });
    assert.equal(result.status, 47, result.output);
    const cargo = (await f.events()).find((event) => event.command === "cargo" && !event.args.includes("--version"));
    for (const [key, value] of Object.entries(overrides)) assert.equal(cargo.env[key], value, key);
  });
}

test("dependency installation uses the lock without changing it", async (t) => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.frontend, "package-lock.json"), "utf8");
  const result = f.helper("frontend_npm_install");
  assert.equal(result.status, 0, result.output);
  assert.deepEqual((await f.events()).filter((event) => event.command === "npm").map((event) => event.args), [["ci"]]);
  assert.equal(await readFile(path.join(f.frontend, "package-lock.json"), "utf8"), before);
});

test("dependency installation without a lock does not create one", async (t) => {
  const f = await fixture(t, { lock: false });
  const result = f.helper("frontend_npm_install");
  assert.equal(result.status, 0, result.output);
  assert.deepEqual((await f.events()).find((event) => event.command === "npm").args, ["install", "--package-lock=false"]);
  await assert.rejects(readFile(path.join(f.frontend, "package-lock.json")), { code: "ENOENT" });
});

test("a failed install returns its status without deleting files or retrying", async (t) => {
  const f = await fixture(t);
  const result = f.helper("frontend_npm_install", { ARTCRAFT_SCRIPT_TEST_NPM_EXIT: "46" });
  assert.equal(await readFile(path.join(f.frontend, "node_modules/keep.txt"), "utf8"), "keep dependencies\n");
  assert.equal(await readFile(path.join(f.frontend, ".nx/keep.txt"), "utf8"), "keep cache\n");
  assert.equal(result.status, 46, result.output);
  assert.equal((await f.events()).filter((event) => event.command === "npm").length, 1);
});

test("a failed production dependency install stops before Cargo", async (t) => {
  const f = await fixture(t);
  const result = f.run("unix_build.sh", [], { cwd: f.root, env: { ARTCRAFT_SCRIPT_TEST_NPM_EXIT: "46" } });
  assert.equal(result.status, 46, result.output);
  assert.ok(!(await f.events()).some((event) => event.command === "cargo" && !event.args.includes("--version")));
});

test("combined launcher bootstraps through the same lock-preserving helper", async (t) => {
  const f = await fixture(t);
  const result = f.run("unix_dev.sh");
  assert.equal(result.status, 0, result.output);
  assert.deepEqual((await f.events()).find((event) => event.command === "npm").args, ["ci"]);
  assert.equal((await f.events()).find((event) => event.command === "launcher").cwd, f.frontend);
});

test("combined launcher leaves installed dependencies alone", async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.frontend, "node_modules/vite"));
  await writeFile(path.join(f.frontend, "node_modules/vite/package.json"), "{}\n");
  const result = f.run("unix_dev.sh");
  assert.equal(result.status, 0, result.output);
  assert.ok(!(await f.events()).some((event) => event.command === "npm"));
});

test("preflight accepts only the supported Node release ranges", async (t) => {
  const f = await fixture(t);
  for (const version of ["v20.19.0", "v20.20.1", "v22.12.0", "v24.0.0"]) {
    assert.equal(f.helper('frontend_preflight "$PWD"', { ARTCRAFT_SCRIPT_TEST_NODE_VERSION: version }).status, 0, version);
  }
  for (const version of ["v18.20.0", "v20.18.3", "v21.0.0", "v22.11.0", "v23.0.0", "v25.0.0"]) {
    assert.notEqual(f.helper('frontend_preflight "$PWD"', { ARTCRAFT_SCRIPT_TEST_NODE_VERSION: version }).status, 0, version);
  }
});

test("preflight reports pnpm artifacts without changing them", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.frontend, "pnpm-lock.yaml"), "keep this file\n");
  const result = f.helper('frontend_preflight "$PWD"');
  assert.notEqual(result.status, 0);
  assert.match(result.output, /pnpm/);
  assert.equal(await readFile(path.join(f.frontend, "pnpm-lock.yaml"), "utf8"), "keep this file\n");
});

async function fixture(t, { lock = true } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "artcraft unix scripts "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "checkout with spaces");
  const frontend = path.join(root, "frontend");
  const rust = path.join(root, "crates/desktop/artcraft");
  const outside = path.join(dir, "unrelated working directory");
  const bin = path.join(dir, "command doubles");
  const record = path.join(dir, "events.jsonl");
  for (const directory of [path.join(root, "script/artcraft"), path.join(root, "script/common"), path.join(frontend, "node_modules/.bin"), path.join(frontend, ".nx"), path.join(frontend, "scripts"), rust, outside, bin]) {
    await mkdir(directory, { recursive: true });
  }
  for (const script of [...frontendScripts, ...nativeScripts, ["unix_dev.sh"]].map(([name]) => name)) {
    await copyFile(path.join(rootDir, "script/artcraft", script), path.join(root, "script/artcraft", script));
    await chmod(path.join(root, "script/artcraft", script), 0o755);
  }
  await copyFile(path.join(rootDir, "script/common/frontend_preflight.sh"), path.join(root, "script/common/frontend_preflight.sh"));
  if (lock) await writeFile(path.join(frontend, "package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(path.join(frontend, "node_modules/keep.txt"), "keep dependencies\n");
  await writeFile(path.join(frontend, ".nx/keep.txt"), "keep cache\n");

  const eventCode = (command) => `
const fs = require("node:fs");
fs.appendFileSync(process.env.ARTCRAFT_SCRIPT_TEST_RECORD, JSON.stringify({
  command: ${JSON.stringify(command)}, args: process.argv.slice(2), cwd: process.cwd(), path: process.env.PATH,
  env: Object.fromEntries(${JSON.stringify(environmentKeys)}.map(key => [key, process.env[key]])),
}) + "\\n");
`;
  await writeCommand(path.join(bin, "npm"), `${eventCode("npm")}process.exit(Number(process.env.ARTCRAFT_SCRIPT_TEST_NPM_EXIT || 0));`);
  await writeCommand(path.join(bin, "cargo"), `${eventCode("cargo")}process.exit(process.argv.includes("--version") ? 0 : Number(process.env.ARTCRAFT_SCRIPT_TEST_CARGO_EXIT || 0));`);
  await writeCommand(path.join(bin, "nx"), `${eventCode("global-nx")}process.exit(Number(process.env.ARTCRAFT_SCRIPT_TEST_NX_EXIT || 82));`);
  await writeCommand(path.join(frontend, "node_modules/.bin/nx"), `${eventCode("local-nx")}process.exit(Number(process.env.ARTCRAFT_SCRIPT_TEST_NX_EXIT || 0));`);
  await writeCommand(path.join(bin, "lsof"), `${eventCode("lsof")}process.exit(1);`);
  await writeCommand(path.join(bin, "touch"), eventCode("touch"));
  await writeCommand(path.join(bin, "node"), `
if (process.argv[2] === "--version") {
  console.log(process.env.ARTCRAFT_SCRIPT_TEST_NODE_VERSION || process.version);
} else {
  const result = require("node:child_process").spawnSync(process.execPath, process.argv.slice(2), { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
`);
  await writeFile(path.join(frontend, "scripts/unix-dev.mjs"), `import { createRequire } from "node:module"; const require = createRequire(import.meta.url); ${eventCode("launcher")}`);

  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ARTCRAFT_SCRIPT_TEST_RECORD: record };
  for (const key of environmentKeys) delete env[key];
  const run = (args, options = {}) => {
    const result = spawnSync("bash", args, { cwd: options.cwd || outside, env: { ...env, ...options.env }, encoding: "utf8", timeout: 10000 });
    assert.ifError(result.error);
    return { ...result, output: result.stdout + result.stderr };
  };
  return {
    root, frontend, rust,
    run: (script, args = [], options = {}) => run([path.join(root, "script/artcraft", script), ...args], options),
    helper: (command, overrides = {}) => run(["-c", `set -euo pipefail; source "$1"; cd "$2"; ${command}`, "helper-test", path.join(root, "script/common/frontend_preflight.sh"), frontend], { env: overrides }),
    async events() {
      try { return (await readFile(record, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    },
  };
}

async function writeCommand(file, code) {
  const source = `${file}.cjs`;
  await writeFile(source, code);
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(file, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(source)} "$@"\n`, { mode: 0o755 });
}
