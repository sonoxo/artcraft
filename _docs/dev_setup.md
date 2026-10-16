# Development setup

ArtCraft's main desktop app uses Rust, Tauri, and a React frontend. The workspace
also contains the [native egui app](../artcraft-native/README.md). Backend services
and website builds live in the separate `artcraft-services` repository.

Run the commands below from the repository root unless a different directory is
specified.

## macOS quick start for this fork

Install [Xcode Command Line Tools](https://v2.tauri.app/start/prerequisites/#macos)
and [Homebrew](https://brew.sh/) first. For the command-line tools, run
`xcode-select --install` and finish Apple's installer. Then:

```bash
# Inspect prerequisites without installing anything
./script/artcraft/macos_setup.sh --check

# Install missing prerequisites, install frontend dependencies, and launch
./script/artcraft/macos_setup.sh --run
```

Run `./script/artcraft/macos_setup.sh` without arguments to set up dependencies
without launching. The helper installs missing CMake, pkg-config, and LLVM
formulas through Homebrew. It uses Homebrew's `node@24` when the current Node
version is unsupported, and `rustup` when a working Rust toolchain is missing.
It ensures Tauri CLI 2 is available, runs `npm ci` in `frontend/`, and checks the
result with the doctor. `--run` then starts the combined development launcher.

Existing supported toolchains are reused. LLVM's executable path and an unset
`LIBCLANG_PATH` are configured for the helper process; the helper does not edit
shell profiles. If Xcode Command Line Tools or Homebrew is absent, it explains
how to install them before continuing. Account setup and generation access are
covered under [Backend and provider access](#backend-and-provider-access).

## Prerequisites for manual setup

Install the following before building the Tauri desktop app:

1. [Rust](https://doc.rust-lang.org/cargo/getting-started/installation.html), using
   the latest stable toolchain. The workspace includes Rust 2024-edition crates.
2. [Node.js](https://nodejs.org/en/download) and npm. **Node 24.x is recommended**.
   Nx 21 also supports **22.12+ within 22.x** and **20.19+ within 20.x**, as listed
   in the [Nx compatibility matrix](https://21.nx.dev/docs/reference/nodejs-typescript-compatibility).
3. Git, needed by the checkout and Git-hosted dependencies.
4. [Tauri CLI 2](https://v2.tauri.app/reference/cli/):

   ```bash
   cargo install tauri-cli --version '^2' --locked
   ```

Nx, Vite, and Vitest are installed with the frontend dependencies. A global Nx
installation is not required. Install the locked frontend dependencies with:

```bash
npm --prefix frontend ci
```

### macOS native dependencies

Use Xcode Command Line Tools or a configured Xcode installation. The HTTP client
dependencies also need CMake, pkg-config, and LLVM/libclang; with Homebrew:

```bash
brew install cmake pkg-config llvm
```

If a direct Cargo invocation reports that bindgen cannot find libclang, make the
Homebrew LLVM library directory available in that terminal:

```bash
export LIBCLANG_PATH="$(brew --prefix llvm)/lib"
```

Keep an existing custom `LIBCLANG_PATH` if it already points to a working
installation. The macOS setup helper handles this for its own build/run process.

### Linux native dependencies

Install the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/#linux)
for your distribution, plus the CMake/LLVM/libclang toolchain used by the HTTP
clients. On Debian or Ubuntu with WebKitGTK 4.1 packages available:

```bash
sudo apt update
sudo apt install build-essential curl wget file git cmake pkg-config \
  clang llvm libclang-dev perl libssl-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev \
  libasound2-dev
```

The alternative native egui app uses `wry` for its Midjourney login window, so it
also needs [WebKitGTK/GTK](https://github.com/tauri-apps/wry#platform-considerations).
Its audio playback needs ALSA development headers (`libasound2-dev` above); see
[Rodio's Linux dependencies](https://github.com/RustAudio/rodio#dependencies-linux-only).
FFmpeg on `PATH` enables its in-app video playback; otherwise videos open in the
system player. A desktop display session and working graphics drivers are needed
to launch either app.

### Windows native dependencies

Install the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows),
including the Microsoft C++ Build Tools and WebView2. The workspace's `wreq`
dependencies also require CMake, Perl, pkg-config, LLVM, and NASM; see the native
prerequisite notes in [Cargo.toml](../Cargo.toml). Use the PowerShell launchers
below after installing the Rust and frontend tools.

## Check the environment

The doctor inspects the current environment without installing dependencies or
starting the app:

```bash
node script/artcraft/doctor.mjs
node script/artcraft/doctor.mjs --json
node script/artcraft/doctor.mjs --frontend-only
```

The frontend check covers Node/npm, Git, lockfiles, and the local Nx/Vite/Vitest
installation. The full check also covers Rust, Tauri CLI 2, native build tools,
libclang, and platform libraries. FFmpeg is optional. `--json` produces a
machine-readable report. A successful prerequisite check does not establish that
a native build, login, or provider generation has succeeded.

The libclang check accepts `LIBCLANG_PATH` as a library file or its containing
directory, including versioned library names. If that override is present but
empty or invalid, unset it or point it to a working installation. Without an
override, the doctor also checks LLVM's library directory, using
`LLVM_CONFIG_PATH` when provided, and common platform locations.

## Mac and Linux development

```bash
# Start the frontend and Rust/Tauri together in one terminal
./script/artcraft/unix_dev.sh

# Optionally start the free-port search at another port
ARTCRAFT_DEV_PORT=6200 ./script/artcraft/unix_dev.sh
```

Use the combined launcher instead of starting the two legacy dev scripts. It
works from any working directory when invoked by its path and installs frontend
dependencies if the local Vite installation is missing. Use one of the supported
Node versions listed above.

The launcher binds Vite to `127.0.0.1`, starting at port **5193** and trying
successive ports until one is available. It leaves existing listeners alone.
Only after the real frontend socket is bound does it start Tauri with that exact
`devUrl`. HTTP and the HMR websocket share the selected port; Rust communicates
through native Tauri IPC and needs no separate HTTP port. Configuration overrides
are passed in memory, without changing the checked-in Tauri config.

The native HTTP bridge normalizes loopback development origins for first-party
API requests so an automatically selected port does not break login or media
loading. See the [desktop session regression checks](../docs/desktop-session-regression.md)
when changing ports, the launcher, or authentication.

JavaScript, TypeScript, React, and CSS changes use Vite hot reload; compatible
React component edits use Fast Refresh. Changes that cannot be hot-replaced
reload the page. Rust changes use `cargo tauri dev`'s automatic **rebuild and app
restart**, including dependent workspace crates. SQLx metadata and SQLite
migrations are also watched. Rust reload is a process restart, so it does not
preserve unsaved in-memory app state. See [Tauri's watch behavior](https://v2.tauri.app/develop/#reacting-to-source-code-changes).

After startup, a Vite configuration restart must reuse the chosen port or report
an error; it cannot silently switch to another port while Tauri uses an old URL.
Ctrl-C stops this session's frontend, Rust watcher/compiler, and desktop app.
If the Rust watcher exits, the launcher closes Vite and propagates the exit code.
It never finds or terminates another app by name or port.

The launcher retains the existing Unix defaults for `VITE_ENVIRONMENT_TYPE`,
`SQLX_OFFLINE`, `RUSTFLAGS`, and the Linux WebKit workarounds. Explicit environment
overrides are preserved. It uses the normal Artcraft app data and Cargo target
directory; port separation does not create an isolated account/data profile, and
concurrent Rust builds can wait on Cargo's build lock.

To verify the launcher without compiling Rust or opening a desktop window:

```bash
node --test frontend/scripts/unix-dev.test.mjs
```

The tests use real Vite listeners and HMR, with a test-owned fake Cargo process
tree. They cover occupied ports, simultaneous launches, React edits, shutdown,
Rust-process failure, and watcher arguments. To verify native Rust reload, run
the launcher, wait for the desktop window, make a Rust source edit, and check for
a rebuild/restart in the same terminal. Frontend edits should update the webview
without restarting the Rust process.

## Windows development

```powershell
# Run the frontend dev server
.\script\artcraft\windows_frontend_dev.ps1

# Run the Tauri Rust application
.\script\artcraft\windows_rust_dev.ps1
```

## Build and validate

Build the frontend and run the supported tests without compiling Rust:

```bash
npm --prefix frontend run build
npm --prefix frontend run test:unit

# macOS or Linux: unit tests plus setup and launcher fixtures
npm --prefix frontend test
```

See the [frontend test commands](../frontend/README.md#tests) for targeted runs
and the separate, unmigrated legacy Jest suite.

The Tauri app uses an embedded SQLite task database. Its migrations are in
`_database/sql/artcraft_migrations/` and its compile-time query cache is in
`.sqlx/`. No database server is needed to build the desktop app:

```bash
SQLX_OFFLINE=true cargo check -p artcraft

# Build the production frontend and desktop bundle
./script/artcraft/unix_build.sh
```

The production script is for macOS and Linux. Windows uses
`script/artcraft/windows_build.ps1`. Distribution signing and notarization
require the appropriate release credentials; local setup does not supply them.

To build and run the alternative egui desktop app:

```bash
cargo run -p artcraft_native --release
```

See its [README](../artcraft-native/README.md) for feature coverage, account
storage, diagnostics, and tests. The workspace defaults to the Tauri app, so
the `-p artcraft_native` package selector is required.

For changes to desktop authentication or request identity, run the existing
local regression fixtures:

```bash
cargo test -p artcraft_client_identity -p tauri-plugin-http --lib
SQLX_OFFLINE=true cargo test -p artcraft --lib login_bridge_tests
```

Use [website-login tests](../docs/website-login.md) and
[desktop session regression checks](../docs/desktop-session-regression.md) for
the related frontend and native acceptance checks. Keep live-provider tests
ignored during routine validation. `SQLX_OFFLINE` controls SQLx query compilation;
Cargo's optional `--offline` flag controls dependency downloads. Neither option
blocks network requests made by running application or test code.

## Backend and provider access

The default desktop API is `https://api.storyteller.ai`. Sign in to ArtCraft for
account-backed library and generation features. Connected providers may require
their own login, API key, subscription, or credits. Building this source does not
provision hosted services, include model weights, or grant model access.

The app creates its local data under `~/Artcraft/`, including settings,
credentials, and task state. The Tauri task database is created and migrated
automatically. Configure provider accounts through the app; credentials do not
belong in the checkout or in build reports.

To use a separately running local backend, set
`~/Artcraft/settings/env_configs.json`:

```json
{"storyteller_host":"localhost","storyteller_port":12345}
```

Local website sign-in also requires the services webapp at
`http://localhost:4201/login/desktop`, using `USE_LOCAL_API=1`, and the matching
backend with its migrations applied. Those services are in `artcraft-services`.
See [website login and API environment](../docs/website-login.md#api-environment)
for the full flow. Use `"storyteller_host":"production"` or omit the override to
use production, then restart the app.

The desktop declares the origin `https://desktop.getartcraft.com` to the hosted
API. Its server allowlist must match; see the
[desktop origin rollout notes](../docs/desktop-session-regression.md#dedicated-desktop-origin-and-rollout)
when coordinating client and service changes. Local build checks cannot verify
the deployed service configuration or an authenticated generation flow.
