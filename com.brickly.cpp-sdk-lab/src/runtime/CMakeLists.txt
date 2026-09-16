cmake_minimum_required(VERSION 3.16)
project(cpp-sdk-lab LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT DEFINED ENV{BRICKLY_HOME})
  message(FATAL_ERROR "Set BRICKLY_HOME to the ai-bricks checkout")
endif()

set(SDK_CPP "$ENV{BRICKLY_HOME}/Brickly/packages/brickly-sdk-cpp")
set(SDK_BIN "${SDK_CPP}/dist/bin")

add_executable(brick main.cpp)
target_include_directories(brick PRIVATE "${SDK_CPP}/include" "${CMAKE_CURRENT_SOURCE_DIR}")

find_package(Threads REQUIRED)
target_link_directories(brick PRIVATE "${SDK_BIN}")
target_link_libraries(brick PRIVATE brickly Threads::Threads)
# Windows：brickly.dll 需由 scripts/build.ps1 以 -ldflags="-s -w" 生成，并与 exe 同目录。
# 宿主 cwd 是 Brick 根目录；macOS/Linux sidecar 必须靠 @loader_path / $ORIGIN，不能靠 cwd。
if(APPLE)
  set_target_properties(brick PROPERTIES BUILD_RPATH "@loader_path" INSTALL_RPATH "@loader_path")
elseif(UNIX)
  set_target_properties(brick PROPERTIES BUILD_RPATH "$ORIGIN" INSTALL_RPATH "$ORIGIN")
endif()
