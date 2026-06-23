#!/bin/bash
# 编译 Go 后端二进制 - macOS / Linux
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR"
BIN_DIR="$SCRIPT_DIR/../bin/mac-arm64"

mkdir -p "$BIN_DIR"

OUT_FILE="$BIN_DIR/brick"
echo "Building Go runtime for mac-arm64 -> $OUT_FILE"

export GOOS=darwin
export GOARCH=arm64
export CGO_ENABLED=0

go build -trimpath -ldflags "-s -w" -o "$OUT_FILE" .

echo "Build success. Size: $(wc -c < "$OUT_FILE") bytes"
