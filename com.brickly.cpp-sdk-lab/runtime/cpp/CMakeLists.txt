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

if(WIN32)
  target_link_directories(brick PRIVATE "${SDK_BIN}")
  target_link_libraries(brick PRIVATE brickly)
  # brickly.dll 需由 scripts/build.ps1 以 -ldflags="-s -w" 生成
else()
  target_link_directories(brick PRIVATE "${SDK_BIN}")
  target_link_libraries(brick PRIVATE brickly)
  set_target_properties(brick PROPERTIES BUILD_RPATH "$ORIGIN")
endif()
