// These tests run the real setup script against temporary executable boundaries.
// They never install Homebrew formulas, Rust toolchains, or npm dependencies.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL("./", import.meta.url));

test("help needs no tools or platform checks", async (t) => {
  const f = await fixture(t, { platform: "Linux", brewWorks: false });
  const result = f.run(["--help"]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /--check/);
  assert.match(result.output, /--run/);
  assert.deepEqual(await f.events(), []);
});

test("unknown, duplicate, and conflicting flags fail before checking tools", async (t) => {
  const f = await fixture(t);
  for (const args of [["--unknown"], ["--check", "--run"], ["--check", "--check"], ["--help", "--run"]]) {
    assert.equal(f.run(args).status, 2, args.join(" "));
  }
  assert.deepEqual(await f.events(), []);
});

test("check delegates to the doctor without running setup and preserves its exit code", async (t) => {
  const f = await fixture(t, { brewWorks: false, xcodeWorks: false, rustWorks: false, doctorExit: 19 });
  const result = f.run(["--check"]);
  assert.equal(result.status, 19, result.output);
  const events = await f.events();
  assert.deepEqual(events.map((event) => event.command), ["doctor"]);
  assert.equal(events[0].cwd, f.root);
});

test("setup refuses Linux without installing anything", async (t) => {
  const f = await fixture(t, { platform: "Linux" });
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /macOS/);
  assert.deepEqual((await f.events()).map((event) => event.command), ["uname"]);
});

test("missing Xcode tools name Apple's install command and stop setup", async (t) => {
  const f = await fixture(t, { xcodeWorks: false });
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /xcode-select --install/);
  assert.deepEqual(await f.mutations(), []);
});

test("unusable Homebrew points to brew.sh without attempting a remote installer", async (t) => {
  const f = await fixture(t, { brewWorks: false });
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /https:\/\/brew\.sh/);
  assert.deepEqual(await f.mutations(), []);
});

test("working Node, Rust, Tauri and Homebrew formulas are reused", async (t) => {
  const f = await fixture(t, { nodeVersion: "v22.12.0" });
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual((await f.mutations()).map(({ command, args }) => ({ command, args })), [{ command: "npm", args: ["ci"] }]);
  const events = await f.events();
  const doctor = events.find((event) => event.command === "doctor");
  assert.equal(events.find((event) => event.command === "npm" && event.args[0] === "ci").cwd, path.join(f.root, "frontend"));
  assert.equal(doctor.cwd, f.root);
  assert.equal(doctor.env.LIBCLANG_PATH, path.join(f.prefixes.llvm, "lib"));
  assert.ok(doctor.env.PATH.startsWith(path.join(f.prefixes.llvm, "bin") + path.delimiter));
  assert.ok(!doctor.env.PATH.includes(path.join(f.prefixes["node@24"], "bin")));
  assert.ok(!events.some((event) => event.command === "launcher"));
});

test("setup installs only missing native formulas", async (t) => {
  const f = await fixture(t, { formulas: { cmake: false, "pkg-config": true, llvm: false } });
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual((await f.mutations()).filter((event) => event.command === "brew").map((event) => event.args), [["install", "cmake"], ["install", "llvm"]]);
});

test("unsupported Node is replaced for this process by Homebrew node@24", async (t) => {
  const f = await fixture(t, { nodeVersion: "v20.18.3" });
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual((await f.mutations()).filter((event) => event.command === "brew").map((event) => event.args), [["install", "node@24"]]);
  const doctor = (await f.events()).find((event) => event.command === "doctor");
  assert.equal(doctor.source, "node24");
  assert.ok(doctor.env.PATH.includes(path.join(f.prefixes["node@24"], "bin")));
});

test("a supported Node with broken npm is preserved and reports how to repair its npm", async (t) => {
  const f = await fixture(t, { nodeVersion: "v22.12.0", npmVersionExit: 1 });
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /same Node.js installer or version manager/);
  assert.deepEqual(await f.mutations(), []);
});

test("stale pnpm artifacts stop setup before installs and remain untouched", async (t) => {
  for (const artifact of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "node_modules/.pnpm/keep.txt"]) {
    const f = await fixture(t, { formulas: { cmake: false } });
    const localFile = path.join(f.root, "frontend", artifact);
    await mkdir(path.dirname(localFile), { recursive: true });
    await writeFile(localFile, "preserve local dependencies\n");
    const result = f.run(["--run"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Stale pnpm artifacts/);
    assert.deepEqual(await f.mutations(), []);
    assert.equal(await readFile(localFile, "utf8"), "preserve local dependencies\n");
    assert.ok(!(await f.events()).some((event) => ["doctor", "launcher"].includes(event.command)));
  }
});

test("a working explicit Rust toolchain is preserved", async (t) => {
  const f = await fixture(t);
  const result = f.run([], { RUSTUP_TOOLCHAIN: "custom-working" });
  assert.equal(result.status, 0, result.output);
  const doctor = (await f.events()).find((event) => event.command === "doctor");
  assert.equal(doctor.env.RUSTUP_TOOLCHAIN, "custom-working");
  assert.ok(!(await f.mutations()).some((event) => event.command === "rustup"));
});

test("a broken explicit Rust override is not silently replaced", async (t) => {
  const f = await fixture(t, { rustWorks: false });
  const result = f.run(["--run"], { RUSTUP_TOOLCHAIN: "custom-unavailable" });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /RUSTUP_TOOLCHAIN/);
  assert.ok(!(await f.mutations()).some((event) => ["rustup", "cargo", "npm"].includes(event.command)));
  assert.ok(!(await f.events()).some((event) => event.command === "launcher"));
  const probes = (await f.events()).filter((event) => ["cargo", "rustc"].includes(event.command));
  assert.ok(probes.length > 0);
  assert.ok(probes.every((event) => event.env.RUSTUP_AUTO_INSTALL === "0"));
});

test("missing Rust is repaired with minimal stable and a checkout override", async (t) => {
  const f = await fixture(t, { rustWorks: false });
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  const rustup = (await f.mutations()).filter((event) => event.command === "rustup");
  assert.deepEqual(rustup.map((event) => event.args), [["toolchain", "install", "stable", "--profile", "minimal"], ["override", "set", "stable"]]);
  assert.ok(rustup.every((event) => event.cwd === f.root));
  assert.ok(!(await f.events()).some((event) => event.command === "rustup" && event.args[0] === "default"));
});

test("missing rustup is installed from Homebrew before scoped Rust setup", async (t) => {
  const f = await fixture(t, { rustWorks: false, rustupWorks: false });
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual((await f.mutations()).filter((event) => event.command === "brew").map((event) => event.args), [["install", "rustup"]]);
  assert.ok((await f.events()).some((event) => event.command === "rustup" && event.source === "brew-rustup"));
});

test("a Rust installation failure propagates before selecting an override or installing npm packages", async (t) => {
  const f = await fixture(t, { rustWorks: false, rustupInstallExit: 43 });
  const result = f.run(["--run"]);
  assert.equal(result.status, 43, result.output);
  const events = await f.events();
  assert.ok(!events.some((event) => event.command === "rustup" && event.args[0] === "override"));
  assert.ok(!events.some((event) => ["npm", "launcher"].includes(event.command) && event.args[0] !== "--version"));
});

test("Tauri CLI 1 is upgraded with the requested locked Cargo installation", async (t) => {
  const f = await fixture(t, { tauriVersion: "tauri-cli 1.8.0" });
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual((await f.mutations()).filter((event) => event.command === "cargo").map((event) => event.args), [["install", "tauri-cli", "--version", "^2", "--locked"]]);
});

test("npm failure is returned without retry, cache removal, doctor or launch", async (t) => {
  const f = await fixture(t, { npmExit: 46 });
  const result = f.run(["--run"]);
  assert.equal(result.status, 46, result.output);
  const events = await f.events();
  assert.equal(events.filter((event) => event.command === "npm" && event.args[0] === "ci").length, 1);
  assert.ok(!events.some((event) => ["doctor", "launcher"].includes(event.command)));
  assert.equal(await readFile(path.join(f.root, "frontend/.nx/keep.txt"), "utf8"), "keep cache\n");
});

test("a failed doctor prevents launch after setup", async (t) => {
  const f = await fixture(t, { doctorExit: 27 });
  const result = f.run(["--run"]);
  assert.equal(result.status, 27, result.output);
  assert.ok(!(await f.events()).some((event) => event.command === "launcher"));
});

test("run preserves explicit environment, uses the checkout, and returns the launcher exit", async (t) => {
  const f = await fixture(t, { launchExit: 33 });
  const overrides = { LIBCLANG_PATH: "/custom LLVM/libclang.dylib", RUSTUP_TOOLCHAIN: "custom-working", SQLX_OFFLINE: "false", RUSTFLAGS: "-C debuginfo=1" };
  const result = f.run(["--run"], overrides);
  assert.equal(result.status, 33, result.output);
  const launcher = (await f.events()).find((event) => event.command === "launcher");
  assert.equal(launcher.cwd, f.root);
  for (const [key, value] of Object.entries(overrides)) assert.equal(launcher.env[key], value, key);
});

test("an explicitly empty LIBCLANG_PATH is not replaced", async (t) => {
  const f = await fixture(t, { doctorExit: 1 });
  const result = f.run([], { LIBCLANG_PATH: "" });
  assert.equal(result.status, 1, result.output);
  assert.equal((await f.events()).find((event) => event.command === "doctor").env.LIBCLANG_PATH, "");
});

async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "artcraft macOS setup "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "checkout with spaces");
  const bin = path.join(dir, "command doubles");
  const outside = path.join(dir, "outside checkout");
  const record = path.join(dir, "events.jsonl");
  const stateFile = path.join(dir, "state.json");
  const doctorPath = path.join(root, "script/artcraft/doctor.mjs");
  const prefixes = Object.fromEntries(["cmake", "pkg-config", "llvm", "node@24", "rustup"].map((name) => [name, path.join(dir, "brew formulas", name)]));
  for (const directory of [bin, outside, path.dirname(doctorPath), path.join(root, "script/common"), path.join(root, "frontend/.nx"), path.join(dir, "cargo home/bin"), ...Object.values(prefixes).map((prefix) => path.join(prefix, "bin"))]) await mkdir(directory, { recursive: true });
  try { await copyFile(path.join(scriptDir, "macos_setup.sh"), path.join(root, "script/artcraft/macos_setup.sh")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await copyFile(path.join(scriptDir, "doctor.mjs"), doctorPath);
  await copyFile(path.join(scriptDir, "../common/frontend_preflight.sh"), path.join(root, "script/common/frontend_preflight.sh"));
  await writeFile(path.join(root, "frontend/package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(path.join(root, "frontend/.nx/keep.txt"), "keep cache\n");
  const state = { platform: "Darwin", brewWorks: true, xcodeWorks: true, nodeVersion: "v24.0.0", rustWorks: true, rustupWorks: true, tauriVersion: "tauri-cli 2.10.0", doctorExit: 0, npmExit: 0, launchExit: 0, rustupInstallExit: 0, ...options,
    formulas: { cmake: true, "pkg-config": true, llvm: true, "node@24": false, rustup: false, ...options.formulas }, prefixes, doctorPath };
  await writeFile(stateFile, JSON.stringify(state));
  const dispatcher = path.join(dir, "commands.cjs");
  await writeFile(dispatcher, commandDouble);
  const writeCommand = async (file, name) => {
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(file, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(dispatcher)} ${quote(name)} "$@"\n`, { mode: 0o755 });
  };
  for (const command of ["uname", "xcode-select", "brew", "node", "npm", "cargo", "rustc", "rustup"]) await writeCommand(path.join(bin, command), command);
  await writeCommand(path.join(prefixes["node@24"], "bin/node"), "node24");
  await writeCommand(path.join(prefixes["node@24"], "bin/npm"), "npm");
  for (const command of ["rustup", "cargo", "rustc"]) await writeCommand(path.join(prefixes.rustup, "bin", command), command === "rustup" ? "brew-rustup" : command);
  await writeCommand(path.join(root, "script/artcraft/unix_dev.sh"), "launcher");
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, CARGO_HOME: path.join(dir, "cargo home"), RUSTUP_HOME: path.join(dir, "rustup home"), ARTCRAFT_MACOS_TEST_STATE: stateFile, ARTCRAFT_MACOS_TEST_RECORD: record };
  for (const key of ["RUSTUP_TOOLCHAIN", "LIBCLANG_PATH", "SQLX_OFFLINE", "RUSTFLAGS", "CARGO_INSTALL_ROOT"]) delete env[key];
  const events = async () => {
    try { return (await readFile(record, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  };
  return {
    root, prefixes, events,
    mutations: async () => (await events()).filter(({ command, args }) => (command === "brew" && args[0] === "install") || (command === "rustup" && ["toolchain", "override", "default"].includes(args[0])) || (command === "cargo" && args[0] === "install") || (command === "npm" && args[0] !== "--version")),
    run(args = [], overrides = {}) {
      const result = spawnSync("/bin/bash", [path.join(root, "script/artcraft/macos_setup.sh"), ...args], { cwd: outside, env: { ...env, ...overrides }, encoding: "utf8", timeout: 10000 });
      assert.ifError(result.error);
      return { ...result, output: result.stdout + result.stderr };
    },
  };
}

const commandDouble = String.raw`
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const state = JSON.parse(fs.readFileSync(process.env.ARTCRAFT_MACOS_TEST_STATE));
const source = process.argv[2];
let command = source === "node24" ? "node" : source === "brew-rustup" ? "rustup" : source;
const args = process.argv.slice(3);
if (command === "node" && args[0] === state.doctorPath) command = "doctor";
fs.appendFileSync(process.env.ARTCRAFT_MACOS_TEST_RECORD, JSON.stringify({ command, source, args, cwd: process.cwd(), env: Object.fromEntries(["PATH", "LIBCLANG_PATH", "RUSTUP_TOOLCHAIN", "RUSTUP_AUTO_INSTALL", "SQLX_OFFLINE", "RUSTFLAGS"].map((key) => [key, process.env[key]])) }) + "\n");
const save = () => fs.writeFileSync(process.env.ARTCRAFT_MACOS_TEST_STATE, JSON.stringify(state));
switch (command) {
  case "uname": console.log(state.platform); break;
  case "xcode-select": if (!state.xcodeWorks) process.exit(1); console.log("/Library/Developer/CommandLineTools"); break;
  case "brew":
    if (!state.brewWorks) process.exit(1);
    if (args[0] === "--version") console.log("Homebrew test boundary");
    else if (args[0] === "list") { if (!state.formulas[args.at(-1)]) process.exit(1); console.log(args.at(-1) + " 1.0.0"); }
    else if (args[0] === "install") { state.formulas[args[1]] = true; save(); }
    else if (args[0] === "--prefix") console.log(state.prefixes[args[1]]);
    else process.exit(91);
    break;
  case "node":
    if (args[0] === "--version") console.log(source === "node24" ? "v24.0.0" : state.nodeVersion);
    else { const child = spawnSync(process.execPath, args, { stdio: "inherit" }); process.exit(child.status ?? 1); }
    break;
  case "npm": if (args[0] === "--version") { if (state.npmVersionExit) process.exit(state.npmVersionExit); console.log("11.0.0"); } else if (args[0] === "ci") process.exit(state.npmExit); else process.exit(92); break;
  case "cargo":
    if (!state.rustWorks) process.exit(1);
    if (args[0] === "tauri") console.log(state.tauriVersion);
    else if (args[0] === "install") { state.tauriVersion = "tauri-cli 2.10.0"; save(); }
    else console.log("cargo 1.94.0");
    break;
  case "rustc": if (!state.rustWorks) process.exit(1); console.log("rustc 1.94.0"); break;
  case "rustup":
    if (!state.rustupWorks && !(source === "brew-rustup" && state.formulas.rustup)) process.exit(127);
    if (args[0] === "--version") console.log("rustup 1.29.1");
    else if (args[0] === "toolchain") { if (state.rustupInstallExit) process.exit(state.rustupInstallExit); state.stableInstalled = true; save(); }
    else if (args[0] === "override") { if (!state.stableInstalled) process.exit(93); state.rustWorks = true; save(); }
    else if (args[0] === "which") console.log(state.prefixes.rustup + "/bin/cargo");
    else process.exit(94);
    break;
  case "doctor": process.exit(state.doctorExit);
  case "launcher": process.exit(state.launchExit);
  default: process.exit(95);
}
`;
