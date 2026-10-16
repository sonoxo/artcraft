#!/usr/bin/env bash
# Assemble/verify a universal release bundle, then verify the shipped ZIP again.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -- "${script_dir}/../.." && pwd)"
variant="${1:-}"

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'ERROR: macOS application packaging requires macOS.' >&2
  exit 1
fi

case "$variant" in
  tauri)
    product_name=ArtCraft
    expected_identifier=ai.artcraft.app
    output_dir="${root_dir}/dist/macos-artcraft"
    ;;
  native)
    product_name='ArtCraft Native'
    expected_identifier=ai.artcraft.native
    output_dir="${root_dir}/dist/macos-artcraft-native"
    ;;
  *)
    echo 'Usage: bash script/artcraft/macos_package.sh <tauri|native>' >&2
    exit 2
    ;;
esac

bundle_dir="${root_dir}/target/universal-apple-darwin/release/bundle/macos"
app_path="${bundle_dir}/${product_name}.app"
mkdir -p "$output_dir"

if [[ "$variant" == native ]]; then
  mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources"
  lipo -create \
    "${root_dir}/target/aarch64-apple-darwin/release/artcraft-native" \
    "${root_dir}/target/x86_64-apple-darwin/release/artcraft-native" \
    -output "$app_path/Contents/MacOS/artcraft-native"
  chmod 755 "$app_path/Contents/MacOS/artcraft-native"
  cp "${root_dir}/crates/desktop/artcraft/icons/icon.icns" "$app_path/Contents/Resources/icon.icns"
  python3 - "$root_dir" "$app_path" <<'PY'
import os
import pathlib
import plistlib
import sys
import tomllib

root_dir, app_path = map(pathlib.Path, sys.argv[1:])
with (root_dir / "artcraft-native/Cargo.toml").open("rb") as manifest:
    version = tomllib.load(manifest)["package"]["version"]
with (app_path / "Contents/Info.plist").open("wb") as output:
    plistlib.dump({
        "CFBundleDevelopmentRegion": "en",
        "CFBundleDisplayName": "ArtCraft Native",
        "CFBundleExecutable": "artcraft-native",
        "CFBundleIconFile": "icon.icns",
        "CFBundleIdentifier": "ai.artcraft.native",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": "ArtCraft Native",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "CFBundleVersion": version,
        "LSMinimumSystemVersion": os.environ.get("MACOSX_DEPLOYMENT_TARGET", "11.0"),
        "NSHighResolutionCapable": True,
    }, output)
PY
  codesign --force --sign - "$app_path"
fi

plutil -lint "$app_path/Contents/Info.plist"
executable_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_path/Contents/Info.plist")"
identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Contents/Info.plist")"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Contents/Info.plist")"
executable_path="$app_path/Contents/MacOS/$executable_name"
test "$identifier" = "$expected_identifier"
test -x "$executable_path"
lipo -verify_arch arm64 x86_64 "$executable_path"
file "$executable_path" | tee "$output_dir/architectures.txt"
otool -L "$executable_path" > "$output_dir/linked-libraries.txt"
if grep -Eq '^[[:space:]]+/(opt/homebrew|usr/local|Users/runner)/' "$output_dir/linked-libraries.txt"; then
  echo 'ERROR: The application links to a build-machine library outside the bundle.' >&2
  exit 1
fi
codesign --verify --deep --strict --verbose=2 "$app_path"
codesign --display --verbose=4 "$app_path" > "$output_dir/signature.txt" 2>&1
grep -q '^Signature=adhoc$' "$output_dir/signature.txt"

archive_name="${product_name// /-}-${version}-macos-universal.zip"
ditto -c -k --sequesterRsrc --keepParent "$app_path" "$output_dir/$archive_name"
(
  cd "$output_dir"
  shasum -a 256 "$archive_name" > SHA256SUMS
)

# Launch the extracted distributable, not a different binary in target/release.
unpack_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/artcraft-package.XXXXXX")"
ditto -x -k "$output_dir/$archive_name" "$unpack_dir"
unpacked_app="$unpack_dir/${product_name}.app"
test -x "$unpacked_app/Contents/MacOS/$executable_name"
lipo -verify_arch arm64 x86_64 "$unpacked_app/Contents/MacOS/$executable_name"
codesign --verify --deep --strict --verbose=2 "$unpacked_app"

python3 - "$root_dir" "$app_path" "$output_dir" "$archive_name" "$variant" <<'PY'
import json
import os
import pathlib
import plistlib
import subprocess
import sys

root_dir, app_path, output_dir = map(pathlib.Path, sys.argv[1:4])
archive_name, variant = sys.argv[4:]
with (app_path / "Contents/Info.plist").open("rb") as source:
    info = plistlib.load(source)
build_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root_dir, text=True).strip()
build_tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=root_dir, text=True).strip()
metadata = {
    "application": info["CFBundleName"],
    "identifier": info["CFBundleIdentifier"],
    "version": info["CFBundleShortVersionString"],
    "architectures": ["arm64", "x86_64"],
    "declared_minimum_macos": info.get("LSMinimumSystemVersion"),
    "profile": "release",
    "signing": "ad-hoc",
    "notarized": False,
    "source_commit": os.environ.get("ARTCRAFT_SOURCE_COMMIT", build_commit),
    "build_commit": build_commit,
    "build_tree": build_tree,
    "workflow_run": f'https://github.com/{os.environ.get("GITHUB_REPOSITORY", "sonoxo/artcraft")}/actions/runs/{os.environ.get("GITHUB_RUN_ID", "local")}',
    "archive": archive_name,
}
(output_dir / "build-info.json").write_text(json.dumps(metadata, indent=2) + "\n")
native_note = "\nArtCraft Native uses an optional external FFmpeg installation for in-app video playback; otherwise it opens video in the system player.\n" if variant == "native" else ""
(output_dir / "README.txt").write_text(f'''{info["CFBundleName"]} {info["CFBundleShortVersionString"]} — macOS universal release build

INSTALL
1. Extract {archive_name} with Archive Utility (double-click the ZIP).
2. Move {app_path.name} to Applications, then open it.
3. This build is ad-hoc signed and is not Apple-notarized. macOS may require
   System Settings > Privacy & Security > Open Anyway after the first attempt.

The executable contains Apple Silicon (arm64) and Intel (x86_64) slices.
The bundle declares macOS {info.get("LSMinimumSystemVersion", "unspecified")} as its minimum; CI launch evidence covers the runner's macOS version only.
The app embeds its frontend/assets; Node.js and Rust are not needed to launch it.
Sign-in and generation use the existing ArtCraft/provider services and require your own account, provider access, and any applicable credits.
{native_note}
VERIFY
Run `shasum -a 256 -c SHA256SUMS` in this folder to verify the ZIP.
build-info.json records source/build commits, architecture, and signing status.
launch/ contains process/window observations and any available screenshots.
A launch smoke check verifies startup and an application window; it does not verify every workflow or authenticated generation.

Source commit: {metadata["source_commit"]}
Build commit: {build_commit}
Workflow: {metadata["workflow_run"]}
''')
PY

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'app-path=%s\n' "$unpacked_app" >> "$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '### %s macOS package\n\n- Archive: `%s`\n- Architectures: Apple Silicon and Intel\n- Signing: ad-hoc; not notarized\n- SHA-256: `%s`\n\n' \
    "$product_name" "$archive_name" "$(cut -d ' ' -f 1 "$output_dir/SHA256SUMS")" >> "$GITHUB_STEP_SUMMARY"
fi
