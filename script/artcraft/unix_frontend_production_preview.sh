#!/usr/bin/env bash
# This works on Linux and MacOS to launch the frontend dev server
set -euo pipefail

root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
frontend_path="${root_dir}/frontend"

source "${root_dir}/script/common/frontend_preflight.sh"
frontend_preflight "${frontend_path}"

echo "Running Artcraft Frontend in Production Build + Preview Mode... (It won't hot reload!)"
echo ""

echo "You'll need to launch the Rust dev server as a second script!"
echo ""

echo "Port 5173 must be available; existing listeners will be left running."

cd "${frontend_path}"

frontend_npm_install

export VITE_ENVIRONMENT_TYPE="${VITE_ENVIRONMENT_TYPE-production}"

exec "${frontend_path}/node_modules/.bin/nx" production-preview artcraft --strictPort "$@"
