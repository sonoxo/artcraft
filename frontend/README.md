# Artcraft frontend

This Nx workspace contains the Tauri desktop frontend in `apps/artcraft` and its
shared libraries in `libs`. Website and Netlify builds live in `artcraft-services`.

Use Node.js **24.x** and npm. Nx 21 also supports Node **22.12+ within 22.x**
and **20.19+ within 20.x**; see the
[Nx compatibility matrix](https://21.nx.dev/docs/reference/nodejs-typescript-compatibility).
Nx and Vite are installed in this workspace; a global Nx installation is not
required.

## Desktop development

On macOS or Linux, start the frontend and Rust/Tauri together from the repository
root:

```bash
./script/artcraft/unix_dev.sh
```

The combined launcher selects a free loopback port starting at **5193**, then
passes that exact URL to Tauri. Frontend changes hot reload and Rust changes
rebuild/restart the app. `ARTCRAFT_DEV_PORT=6200` changes the starting port. Use
this launcher instead of starting the legacy Unix frontend and Rust scripts
in separate terminals.

See [development setup](../_docs/dev_setup.md) for the macOS setup helper,
Rust/Tauri and Linux system prerequisites, and API/account configuration. On
Windows, use `script/artcraft/windows_frontend_dev.ps1` and
`script/artcraft/windows_rust_dev.ps1` in separate terminals.

## Frontend installation and build

Run the following commands from `frontend/`:

```bash
npm ci
npm run build
```

For a standalone frontend dev server, run `npx nx dev artcraft` and use the URL
it prints. This starts Vite only; native desktop features such as login and
provider connections require the Tauri app.

From the repository root, inspect frontend prerequisites without installing or
building:

```bash
node script/artcraft/doctor.mjs --frontend-only
```

The default desktop setup uses hosted ArtCraft APIs and connected provider
accounts. Building the frontend does not provision the backend or supply model
access; backend services and website builds are maintained in `artcraft-services`.

## Tests

Run these commands from `frontend/` after `npm ci`:

| Command                         | Scope                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run test:unit`             | All current Vitest app and shared-library tests, with at most two workers.                     |
| `npm test --workspace=artcraft` | The desktop app's Vitest tests in `apps/artcraft/app/src`.                                     |
| `npm run test:tooling`          | Doctor, setup, shell-script, and combined-launcher fixtures; requires macOS or Linux and Bash. |
| `npm test`                      | The full Vitest suite followed by the tooling fixtures; requires macOS or Linux and Bash.      |

The Vitest workspace loads the app's dedicated test configuration once and each
shared library's Vite test configuration. Native calls use explicit test mocks;
these tests do not establish a successful desktop launch or a live provider
generation. The video-editor tests load the real WASM binary through Vitest's
Node transform. Tooling tests use temporary directories and command fixtures;
the combined-launcher fixtures also open real loopback Vite listeners.

The older API tests in `apps/artcraft/test/app` are retained separately under
`npm run test:legacy --workspace=artcraft`. They use Jest, whose runner is not
installed by the current lockfile, and are not part of the supported Vitest or
default test run. A supported Jest setup or a migration to Vitest is needed
before that suite can join routine validation. A passing `npm test` does not
claim coverage for it.

## Workspace layout

The Vite build writes `apps/artcraft/dist`, which Tauri bundles. Public resources
come from `apps/artcraft/app/public`. The app also needs its retained libraries,
root package lock, TypeScript project references, and Nx/Vite configuration.
The aliases in `tsconfig.base.json` resolve shared libraries to their source for
both development and production. The app's Vite configuration loads this file
explicitly so imports inside shared libraries use the same aliases. The desktop
build does not require library `dist/` outputs or a separate library build.

Import shared libraries by the names declared in their `package.json` files:

```ts
import { Button } from "@storyteller/ui-button";
import { Modal } from "@storyteller/ui-modal";
```

Use the workspace-local Nx version through `npx nx`. `npm ci` and the release
workflows use the checked-in lockfile; do not reinstall different Nx versions
inside CI.

`clean_modules.sh` is an explicit cleanup command that removes build outputs,
Nx caches, and frontend dependencies. Do not run it when preserving local build
outputs during repository pruning.
