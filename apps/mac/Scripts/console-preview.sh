#!/usr/bin/env bash
# Safe visual preview of the current UI with fake state, without a daemon or audio.
# Usage: console-preview.sh [activity|library|tasks|education|settings|waveform|waveform-open|notch] [output.png]
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD=".build/ui-preview"
BIN="$BUILD/ui-preview"
mkdir -p "$BUILD"
SOURCES=(Sources/Hormes/Model/*.swift Sources/Hormes/UI/*.swift Sources/Hormes/UI/Console/*.swift
  Sources/Hormes/UI/Orb/*.swift Sources/Hormes/UI/Overlay/*.swift Sources/Hormes/Permissions/*.swift Scripts/PreviewMain.swift)
needs_build=0
if [[ ! -x "$BIN" ]]; then needs_build=1; else
  for f in "${SOURCES[@]}"; do if [[ "$f" -nt "$BIN" ]]; then needs_build=1; break; fi; done
fi
if [[ $needs_build == 1 ]]; then
  swiftc -Onone -swift-version 5 -parse-as-library -target arm64-apple-macosx14.0 -o "$BIN" "${SOURCES[@]}"
fi
if [[ "${1:-}" == "--build-only" ]]; then exit 0; fi
export PREVIEW_SCENARIO="${1:-activity}"
export PREVIEW_OUT="${2:-/tmp/hormes-preview-$PREVIEW_SCENARIO.png}"
export HORMES_NO_AUDIO=1 HORMES_AUTO_WAKE=0
exec "$BIN"
