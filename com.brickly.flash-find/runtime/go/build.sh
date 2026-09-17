#!/usr/bin/env bash
# 闪电搜索 runtime 构建：
#   1. clang++ 编译 vendored MacEverything core + re2 + ff_bridge -> 静态库（按架构）
#   2. CGO_ENABLED=1 go build -> runtime/<key>/brick
# 上游: github.com/joshua-wu/MacEverything @ 26f0332c (MIT)，见 core/maceverything/LICENSE
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_ROOT="$ROOT/runtime"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TARGETS="${1:-mac-arm64}"

CORE="$SRC/core/maceverything"
FFB="$SRC/core/ffbridge"
RE2="$SRC/core/re2"

build_core() {
  local key="$1" arch="$2"
  local out="$SRC/build/$key"
  mkdir -p "$out/obj"
  local FLAGS=(-std=c++20 -O2 -DNDEBUG -fPIC -arch "$arch" -I"$FFB" -I"$CORE" -I"$RE2")

  echo "  compiling re2 ($key)..."
  local re2_srcs=()
  # 只编运行时源码：re2/ 顶层 + util/（testing/ 要 gtest，pcre.cc 要 PCRE，全跳过）
  while IFS= read -r f; do re2_srcs+=("$f"); done < \
    <(find "$RE2/re2" -maxdepth 1 -name '*.cc' ! -name '*_test.cc' | sort; \
      find "$RE2/util" -maxdepth 1 -name '*.cc' ! -name 'pcre.cc' ! -name '*_test.cc' | sort)
  local jobs=() objs=()
  for f in "${re2_srcs[@]}"; do
    local o="$out/obj/re2_$(echo "$f" | sed "s|$RE2/||; s|/|_|g; s|.cc$|.o|")"
    jobs+=("$f"); objs+=("$o")
  done
  for i in "${!jobs[@]}"; do clang++ "${FLAGS[@]}" -c "${jobs[$i]}" -o "${objs[$i]}" & done
  wait
  ar rcs "$out/libre2.a" "${objs[@]}"

  echo "  compiling core ($key)..."
  local core_objs=()
  for f in "$CORE"/*.cpp "$FFB/ff_bridge.cpp"; do
    local o="$out/obj/core_$(basename "${f%.cpp}").o"
    clang++ "${FLAGS[@]}" -c "$f" -o "$o"
    core_objs+=("$o")
  done
  ar rcs "$out/libffcore.a" "${core_objs[@]}"
  echo "  libs: $(wc -c < "$out/libffcore.a") + $(wc -c < "$out/libre2.a") bytes"
}

build_one() {
  local key="$1" arch="$2" goarch="$3"
  build_core "$key" "$arch"
  rm -rf "$SRC/build/current"
  ln -sfn "$key" "$SRC/build/current"
  local out_dir="$RUNTIME_ROOT/$key"
  mkdir -p "$out_dir"
  local out_file="$out_dir/brick"
  echo "Building go binary $key -> $out_file"
  (
    cd "$SRC"
    CGO_ENABLED=1 GOOS=darwin GOARCH="$goarch" \
      CC="clang -arch $arch" CXX="clang++ -arch $arch" \
      go build -trimpath -ldflags "-s -w -X main.buildStamp=$STAMP" -o "$out_file" .
  )
  echo "  OK  $(wc -c < "$out_file") bytes"
}

IFS=',' read -ra items <<< "$TARGETS"
for key in "${items[@]}"; do
  key="$(echo "$key" | xargs)"
  case "$key" in
    mac-arm64) build_one mac-arm64 arm64 arm64 ;;
    mac-x64)   build_one mac-x64 x86_64 amd64 ;;
    *) echo "Unknown target: $key (flash-find is macOS only)" >&2; exit 1 ;;
  esac
done
echo Done.
