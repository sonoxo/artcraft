#!/usr/bin/env bash
# Shared preflight checks for the frontend dev/build scripts.
#
# Usage (from a script that has set ${frontend_path}):
#
#   source "${root_dir}/script/common/frontend_preflight.sh"
#   frontend_preflight "${frontend_path}"
#   ...
#   pushd "${frontend_path}"
#   frontend_npm_install
#

# Match the frontend package engines and Nx 21's supported Node releases.
FRONTEND_NODE_REQUIREMENT="20.19+ (20.x), 22.12+ (22.x), or 24.x (recommended)"

frontend_preflight() {
  local frontend_path="$1"

  if [ ! -d "${frontend_path}" ]; then
    echo "ERROR: frontend directory not found at: ${frontend_path}"
    echo "Check that the frontend is present in this checkout."
    return 1
  fi

  # --- Node and npm must be installed ---
  if ! command -v node &>/dev/null; then
    echo "ERROR: node is not installed (or not on PATH)."
    echo "Install Node.js ${FRONTEND_NODE_REQUIREMENT} via nvm (https://github.com/nvm-sh/nvm),"
    echo "https://nodejs.org, or:"
    echo "  nvm install 24"
    return 1
  fi

  if ! command -v npm &>/dev/null; then
    echo "ERROR: npm is not installed (or not on PATH). It normally ships with Node.js."
    echo "Reinstall Node.js to get it back."
    return 1
  fi

  local node_version node_major node_minor
  node_version=$(node --version)
  if [[ ! "${node_version}" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    echo "ERROR: Cannot determine the Node.js version from: ${node_version}"
    return 1
  fi
  node_major="${BASH_REMATCH[1]}"
  node_minor="${BASH_REMATCH[2]}"
  if ! (( (node_major == 20 && node_minor >= 19) \
      || (node_major == 22 && node_minor >= 12) \
      || node_major == 24 )); then
    echo "ERROR: Node.js ${FRONTEND_NODE_REQUIREMENT} is required (found ${node_version})."
    echo "Install Node.js 24 with 'nvm install 24' or https://nodejs.org."
    return 1
  fi

  # --- The frontend uses npm; stale pnpm state breaks installs ---
  # pnpm was briefly adopted ("add pnpm to solve build issues") and then dropped
  # ("fix(frontend): consume video-editor libs via nx path aliases, drop pnpm").
  # A node_modules tree written by pnpm makes npm fail with ENOTEMPTY errors.
  if [ -e "${frontend_path}/pnpm-lock.yaml" ] \
      || [ -e "${frontend_path}/pnpm-workspace.yaml" ] \
      || [ -d "${frontend_path}/node_modules/.pnpm" ]; then
    echo "ERROR: Stale pnpm artifacts detected in ${frontend_path}."
    echo "The frontend uses npm (pnpm was dropped; see frontend/README.md)."
    echo "Move or remove these artifacts explicitly before retrying. No files were changed."
    return 1
  fi
}

# Install from the current frontend directory without rewriting the lockfile.
# npm ci manages node_modules itself; never clear caches or retry destructively
# when an install fails. Return npm's status so the caller stops immediately.
frontend_npm_install() {
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install --package-lock=false
  fi
}
