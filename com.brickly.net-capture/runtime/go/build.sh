#!/usr/bin/env bash
set -euo pipefail

brick_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
src_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin_root="$brick_root/bin"
stamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

targets=("$@")
if [ "${#targets[@]}" -eq 0 ]; then
  targets=("mac-arm64" "mac-x64")
fi

target_parts() {
  case "$1" in
    win-x64) echo "windows amd64 .exe" ;;
    mac-x64) echo "darwin amd64 -" ;;
    mac-arm64) echo "darwin arm64 -" ;;
    *) return 1 ;;
  esac
}

cd "$src_dir"
for target in "${targets[@]}"; do
  if ! parts="$(target_parts "$target")"; then
    echo "Unknown target: $target. Skipped." >&2
    continue
  fi
  read -r goos goarch suffix <<< "$parts"
  out_dir="$bin_root/$target"
  mkdir -p "$out_dir"
  if [ "$suffix" = "-" ]; then
    suffix=""
  fi
  out_file="$out_dir/brick$suffix"

  echo "Building $target -> $out_file"
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=1 \
    go build -trimpath -ldflags "-s -w -X main.buildStamp=$stamp" -o "$out_file" .
  chmod +x "$out_file"
done

echo "Done."
