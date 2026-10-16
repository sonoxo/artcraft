#!/usr/bin/env bash
# Launch the unpacked .app and require a live process plus an on-screen window.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_path="${1:-}"
output_dir="${2:-}"
variant="${3:-tauri}"

if [[ "$(uname -s)" != Darwin || -z "$app_path" || -z "$output_dir" ]]; then
  echo 'Usage (macOS): bash script/artcraft/macos_launch_smoke.sh <app-bundle> <evidence-directory> [native]' >&2
  exit 2
fi

mkdir -p "$output_dir"
output_dir="$(cd -- "$output_dir" && pwd)"
executable_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_path/Contents/Info.plist")"
executable_path="$app_path/Contents/MacOS/$executable_name"
test -x "$executable_path"

probe_path="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/artcraft-macos-window-probe"
if [[ ! -x "$probe_path" ]]; then
  swiftc "$script_dir/macos_window_probe.swift" -o "$probe_path"
fi

app_pid=''
cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ "$variant" == native ]]; then
  # The native app has a built-in renderer screenshot after eight seconds.
  # Do not set ARTCRAFT_SCREENSHOT_EXIT: even a value of 0 requests an exit.
  env -u ARTCRAFT_SCREENSHOT_EXIT ARTCRAFT_SCREENSHOT="$output_dir/rendered-window.png" \
    "$executable_path" > "$output_dir/application.log" 2>&1 &
else
  "$executable_path" > "$output_dir/application.log" 2>&1 &
fi
app_pid=$!
printf '%s\n' "$app_pid" > "$output_dir/process-id.txt"
sw_vers > "$output_dir/macos-version.txt"
uname -m > "$output_dir/tested-architecture.txt"

# Startup may create a process before a usable window. Wait at least 20 seconds
# and up to 60 seconds, failing on an early exit or absent application window.
window_seen=false
for elapsed in $(seq 1 60); do
  sleep 1
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "ERROR: $executable_name exited during startup." >&2
    cat "$output_dir/application.log" >&2
    exit 1
  fi
  if "$probe_path" "$app_pid" > "$output_dir/windows.json" 2> "$output_dir/window-probe.log"; then
    window_seen=true
    if (( elapsed >= 20 )); then
      break
    fi
  else
    window_seen=false
  fi
done

if [[ "$window_seen" != true ]]; then
  echo "ERROR: $executable_name never presented an on-screen application window." >&2
  cat "$output_dir/application.log" "$output_dir/window-probe.log" >&2
  exit 1
fi

ps -p "$app_pid" -o pid=,etime=,command= > "$output_dir/process.txt"
window_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["windows"][0]["id"])' "$output_dir/windows.json")"
if screencapture -x -l "$window_id" "$output_dir/window.png" 2> "$output_dir/screenshot.log"; then
  echo 'Window capture saved.' >> "$output_dir/screenshot.log"
else
  echo 'Screen recording is unavailable on this runner; process and window metadata remain the launch evidence.' >> "$output_dir/screenshot.log"
fi

if [[ "$variant" == native ]]; then
  test -s "$output_dir/rendered-window.png"
fi
printf 'PASS: %s stayed running for at least 20 seconds and presented a visible window.\nThis checks startup only; authenticated generation and all user interactions are outside this smoke check.\n' \
  "$executable_name" > "$output_dir/result.txt"
cat "$output_dir/result.txt"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '\nLaunch smoke: `%s` passed on `%s`. See the artifact launch evidence.\n' "$executable_name" "$(uname -m)" >> "$GITHUB_STEP_SUMMARY"
fi
