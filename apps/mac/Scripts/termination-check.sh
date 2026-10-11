#!/usr/bin/env bash
# Native signal → asynchronous-save → quit regression. Starts only an empty,
# prohibited test app, never Hormes or a provider/microphone session.
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD=".build/termination-check"
BIN="$BUILD/termination-check"
mkdir -p "$BUILD"
SOURCES=(Sources/Hormes/App/QuitRequest.swift Scripts/TerminationCheckMain.swift)
if [[ ! -x "$BIN" || "${SOURCES[0]}" -nt "$BIN" || "${SOURCES[1]}" -nt "$BIN" ]]; then
  swiftc -O -swift-version 5 -parse-as-library -target arm64-apple-macosx14.0 \
    -framework AppKit "${SOURCES[@]}" -o "$BIN"
fi
HORMES_AUTO_WAKE=0 HORMES_NO_AUDIO=1 "$BIN"
