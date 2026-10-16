#!/usr/bin/env bash
# Prepare this checkout for desktop development without changing shell profiles.
set -euo pipefail

main() {
  local mode=setup
  if [[ $# -gt 1 ]]; then
    printf 'Use one of --check, --run, or --help (see --help).\n' >&2
    exit 2
  fi
  if [[ $# -eq 1 ]]; then
    case "$1" in
      --help|-h) usage; exit 0 ;;
      --check) mode=check ;;
      --run) mode=run ;;
      *) printf 'Unknown argument: %s (see --help)\n' "$1" >&2; exit 2 ;;
    esac
  fi

  local root_dir doctor_path
  root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
  doctor_path="${root_dir}/script/artcraft/doctor.mjs"
  cd "$root_dir"

  if [[ "$mode" == check ]]; then
    if ! command -v node >/dev/null 2>&1; then
      printf 'Node.js is required to run the read-only doctor. Install Node.js 24 LTS, then retry.\n' >&2
      exit 1
    fi
    exec node "$doctor_path"
  fi

  if [[ "$(uname -s)" != Darwin ]]; then
    printf 'This setup command requires macOS. See _docs/dev_setup.md for other platforms.\n' >&2
    exit 1
  fi
  if ! xcode-select -p >/dev/null 2>&1; then
    printf 'Install Xcode Command Line Tools with: xcode-select --install\nFinish the installer, then rerun this setup.\n' >&2
    exit 1
  fi

  local brew_path
  brew_path="$(command -v brew || true)"
  if [[ -z "$brew_path" ]]; then
    if [[ -x /opt/homebrew/bin/brew ]]; then
      brew_path=/opt/homebrew/bin/brew
    elif [[ -x /usr/local/bin/brew ]]; then
      brew_path=/usr/local/bin/brew
    fi
  fi
  if [[ -z "$brew_path" ]] || ! "$brew_path" --version >/dev/null 2>&1; then
    printf 'Install or repair Homebrew using the instructions at https://brew.sh, then rerun this setup.\n' >&2
    exit 1
  fi
  # Appending exposes linked formulas without replacing a working Node from nvm.
  export PATH="${PATH}:$(dirname -- "$brew_path")"

  local node_prefix llvm_prefix cargo_home rustup_prefix cargo_path
  if ! supported_node "$doctor_path"; then
    ensure_formula "$brew_path" node@24
    node_prefix="$("$brew_path" --prefix node@24)"
    export PATH="${node_prefix}/bin:${PATH}"
    if ! supported_node "$doctor_path"; then
      printf 'Homebrew node@24 could not run. Repair that installation, then retry.\n' >&2
      exit 1
    fi
  fi
  if ! npm --version >/dev/null 2>&1; then
    printf 'The selected Node.js installation needs a working npm. Install or repair npm through the same Node.js installer or version manager, then retry.\n' >&2
    exit 1
  fi
  source "${root_dir}/script/common/frontend_preflight.sh"
  frontend_preflight "${root_dir}/frontend"

  ensure_formula "$brew_path" cmake
  ensure_formula "$brew_path" pkg-config
  ensure_formula "$brew_path" llvm
  llvm_prefix="$("$brew_path" --prefix llvm)"
  export PATH="${llvm_prefix}/bin:${PATH}"
  if [[ "${LIBCLANG_PATH+x}" != x ]]; then
    export LIBCLANG_PATH="${llvm_prefix}/lib"
  fi

  cargo_home="${CARGO_HOME:-${HOME}/.cargo}"
  if ! rust_works; then
    # A normal rustup installation may exist even when a shell has not loaded it.
    if [[ -d "${cargo_home}/bin" ]]; then
      export PATH="${cargo_home}/bin:${PATH}"
    fi
    if ! rust_works; then
      if [[ "${RUSTUP_TOOLCHAIN+x}" == x ]]; then
        printf 'The explicit RUSTUP_TOOLCHAIN=%s could not run cargo and rustc. Repair that toolchain or unset the override before rerunning setup.\n' "$RUSTUP_TOOLCHAIN" >&2
        exit 1
      fi
      if ! rustup --version >/dev/null 2>&1; then
        ensure_formula "$brew_path" rustup
        rustup_prefix="$("$brew_path" --prefix rustup)"
        export PATH="${rustup_prefix}/bin:${PATH}"
      fi
      rustup toolchain install stable --profile minimal
      rustup override set stable
      if ! rust_works; then
        cargo_path="$(rustup which --toolchain stable cargo)"
        export PATH="$(dirname -- "$cargo_path"):${PATH}"
      fi
      if ! rust_works; then
        printf 'The installed stable Rust toolchain could not run cargo and rustc. Resolve the Rust errors, then retry.\n' >&2
        exit 1
      fi
    fi
  fi

  # Cargo-installed commands must be discoverable by this setup and the launcher.
  export PATH="${PATH}:${CARGO_INSTALL_ROOT:-$cargo_home}/bin"
  if ! tauri_works; then
    cargo install tauri-cli --version '^2' --locked
  fi

  cd "${root_dir}/frontend"
  npm ci
  cd "$root_dir"
  node "$doctor_path"
  if [[ "$mode" == run ]]; then
    exec "${root_dir}/script/artcraft/unix_dev.sh"
  fi
}

supported_node() {
  local version
  version="$(node --version 2>/dev/null)" || return 1
  # Share the doctor's version policy. Pass the version first so importing the
  # module does not match its CLI entry point and run the full doctor early.
  node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const { supportsNode } = await import(pathToFileURL(process.argv[2]).href);
    process.exit(supportsNode(process.argv[1]) ? 0 : 1);
  ' "$version" "$1" >/dev/null 2>&1
}

ensure_formula() {
  if ! "$1" list --versions "$2" >/dev/null 2>&1; then
    "$1" install "$2"
  fi
}

rust_works() {
  # A probe must not cause rustup to download a missing explicit toolchain.
  RUSTUP_AUTO_INSTALL=0 cargo --version >/dev/null 2>&1 &&
    RUSTUP_AUTO_INSTALL=0 rustc --version >/dev/null 2>&1
}

tauri_works() {
  local version
  version="$(RUSTUP_AUTO_INSTALL=0 cargo tauri --version 2>/dev/null)" || return 1
  [[ "$version" =~ tauri(-cli)?[[:space:]]+2\. ]]
}

usage() {
  printf '%s\n' 'Usage: ./script/artcraft/macos_setup.sh [--check | --run | --help]

With no option, prepare this checkout for desktop development on macOS:
  Reuse working Node.js 24.x, 22.12+, or 20.19+ and Rust installations.
  Install missing Homebrew formulas, Rust stable, and Cargo Tauri CLI 2.
  Install locked frontend dependencies with npm ci, then run the doctor.

Requires existing Xcode Command Line Tools and Homebrew (https://brew.sh).
Path and LLVM settings apply only to this process and its launched children.
Missing Rust uses a stable toolchain override scoped to this checkout.
Existing explicit environment overrides are preserved.

  --check  Run the read-only doctor; do not install or configure anything.
  --run    Complete setup, then start the desktop development launcher.
  --help   Show this help without checking the platform or installed tools.'
}

main "$@"
