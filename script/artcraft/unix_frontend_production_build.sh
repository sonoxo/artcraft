#!/usr/bin/env bash
# This works on Linux and MacOS to build the production frontend.
set -euo pipefail

root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
frontend_path="${root_dir}/frontend"

source "${root_dir}/script/common/frontend_preflight.sh"
frontend_preflight "${frontend_path}"

echo "Running Artcraft Frontend Build..."
echo ""

cd "${frontend_path}"

frontend_npm_install

export VITE_ENVIRONMENT_TYPE="${VITE_ENVIRONMENT_TYPE-production}"

exec "${frontend_path}/node_modules/.bin/nx" build artcraft "$@"
