#!/usr/bin/env bash
# Headless checks against a fake daemon: protocol skew and refused transport, the outbox,
# typed-message delivery, saved conversation loading and append-only records. No window,
# microphone, TCC prompts, real daemon or writes under ~/.hormes.
#   Scripts/w3-3-check.sh                    # fixtures/snapshot-threads.json; the undecodable snapshot lacks `threads`
#   DROP_KEY=permissions Scripts/w3-3-check.sh
#   Scripts/w3-3-check.sh --build-only
# Compiles into its own output directory, and only when a source is newer than the binary.
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD=".build/w3-3-check"
BIN="$BUILD/w3-3-check"
mkdir -p "$BUILD"
SOURCES=(Sources/Hormes/Model/*.swift Sources/Hormes/UI/*.swift Sources/Hormes/UI/Console/*.swift
  Sources/Hormes/Daemon/Wire.swift Sources/Hormes/Daemon/EngineClient.swift Sources/Hormes/Daemon/NativeCalendarReader.swift Scripts/W33CheckMain.swift)
needs_build=0
if [[ ! -x "$BIN" ]]; then
  needs_build=1
else
  for f in "${SOURCES[@]}"; do
    if [[ "$f" -nt "$BIN" ]]; then needs_build=1; fi
  done
fi
if [[ $needs_build == 1 ]]; then
  echo "building $BIN" >&2
  swiftc -O -swift-version 5 -parse-as-library -target arm64-apple-macosx14.0 \
    -o "$BIN" "${SOURCES[@]}" 1>&2
fi
if [[ "${1:-}" == "--build-only" ]]; then
  echo "built $BIN" >&2
  exit 0
fi
exec "$BIN" "${1:-Scripts/fixtures/snapshot-threads.json}"
