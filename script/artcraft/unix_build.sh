#!/usr/bin/env bash
# This works on Linux and MacOS to build production Artcraft

set -euo pipefail

echo "Building production Artcraft..."
echo ""

root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
frontend_path="${root_dir}/frontend"
rust_crate_path="${root_dir}/crates/desktop/artcraft"

# Build with the desktop app configuration.
config_path="${rust_crate_path}/tauri.conf.json"

source "${root_dir}/script/common/frontend_preflight.sh"
frontend_preflight "${frontend_path}"

cd "${frontend_path}"
frontend_npm_install

if [[ ! -x "${frontend_path}/node_modules/.bin/nx" ]]; then
  echo "ERROR: The frontend's local Nx executable is missing after installation." >&2
  exit 1
fi
# Tauri's frontend hooks must resolve this checkout's installed Nx.
export PATH="${frontend_path}/node_modules/.bin:${PATH}"

export TAURI_FRONTEND_PATH="${frontend_path}"
export TAURI_APP_PATH="${rust_crate_path}"

# NB: The "frontend dev" script sets "production" too, so this must only control the
# hostnames we use, not minification, etc.
export VITE_ENVIRONMENT_TYPE="${VITE_ENVIRONMENT_TYPE-production}"
export SQLX_OFFLINE="${SQLX_OFFLINE-true}"

# This appears to trigger "nx build" instead of "nx dev".
cd "${root_dir}"
cargo tauri build --config "${config_path}" "$@"

echo "Done!"

date "+Finished on %A, %B %e - %H:%M:%S (local timezone)"

