#!/usr/bin/env bash
# The waveform and notch share the current safe visual preview.
set -euo pipefail
exec "$(dirname "$0")/console-preview.sh" "${1:-waveform}" "${2:-/tmp/hormes-preview-waveform.png}"
