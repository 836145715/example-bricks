#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$(cd "$(dirname "$0")" && pwd)"
BIN_ROOT="$ROOT/bin"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TARGETS="${1:-mac-arm64}"

build_one() {
  local key="$1" goos="$2" goarch="$3" suffix="$4"
  local out_dir="$BIN_ROOT/$key"
  mkdir -p "$out_dir"
  local out_file="$out_dir/brick$suffix"
  echo "Building $key -> $out_file"
  (
    cd "$SRC"
    GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 \
      go build -trimpath -ldflags "-s -w -X main.buildStamp=$STAMP" -o "$out_file" .
  )
  echo "  OK  $(wc -c < "$out_file") bytes"
}

IFS=',' read -ra items <<< "$TARGETS"
for key in "${items[@]}"; do
  key="$(echo "$key" | xargs)"
  case "$key" in
    win-x64) build_one win-x64 windows amd64 .exe ;;
    win-arm64) build_one win-arm64 windows arm64 .exe ;;
    mac-x64) build_one mac-x64 darwin amd64 '' ;;
    mac-arm64) build_one mac-arm64 darwin arm64 '' ;;
    *) echo "Unknown target: $key" >&2; exit 1 ;;
  esac
done
echo Done.
