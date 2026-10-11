#!/usr/bin/env bash
# The Swift model's acceptance numbers, without an XCTest target (apps/mac has none):
#   Scripts/appstate-bench.sh              # model stage: AppStateBench (Model/*.swift, ~15 s to build)
#   Scripts/appstate-bench.sh all          # model checks
#   Scripts/appstate-bench.sh --build-only [stage]
# model: 20 000 append deltas → 400 kept in < 200 ms (the timing line carries the measured ms),
# prepend dedupes and keeps order and counts as loaded (prependedCount), a re-sent trimmed message
# is skipped, isLive false when disconnected or ended, no final == false item survives the
# daemon-problem republish, SettingsPatch json carries language / accent / memory, an empty
# chain answer for a chain with members falls back, a fired event rings only with ring:true
# (SL-14), MissedWhy carries zone-moved.
# Compiles with -D DEBUG (the benches sit behind `#if DEBUG`; the -O preview binaries carry none
# of it) into its own output directory (never the shared .build products), and only when a
# source is newer than the binary. One line per check, "ok" or "FAIL" first; exit 1 on a FAIL.
# Foundation only: no window, no TCC, no daemon, no Live session.
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD_ONLY=0
if [[ "${1:-}" == "--build-only" ]]; then BUILD_ONLY=1; shift; fi
STAGE="${1:-model}"
BUILD=".build/appstate-bench"
mkdir -p "$BUILD"

# build <bin> <extra swiftc flags> <sources...>: swiftc only when a source is newer than the binary.
build() {
  local bin="$1" flags="$2"; shift 2
  local needs=0 f
  if [[ ! -x "$bin" ]]; then needs=1; else for f in "$@"; do [[ "$f" -nt "$bin" ]] && needs=1; done; fi
  if [[ $needs == 1 ]]; then
    echo "building $bin" >&2
    # shellcheck disable=SC2086
    swiftc -O -swift-version 5 -parse-as-library -target arm64-apple-macosx14.0 -D DEBUG $flags -o "$bin" "$@" 1>&2
  fi
}

run_model() {
  build "$BUILD/appstate-bench" "" Sources/Hormes/Model/*.swift Scripts/AppStateBenchMain.swift
  [[ $BUILD_ONLY == 1 ]] || "$BUILD/appstate-bench"
}

case "$STAGE" in
  model|all) run_model ;;
  *) echo "usage: $0 [--build-only] [model|all]" >&2; exit 2 ;;
esac
