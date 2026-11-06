# Haus — A thoughtful home.
# Copyright © 2026 Andrii Vynohradov. All rights reserved.
# Licensed under the GNU General Public License v3.0 or later; see LICENSE.
# SPDX-License-Identifier: GPL-3.0-or-later.

cmake_minimum_required(VERSION 3.16)
project(haus_vision VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(
  haus_vision_core STATIC
  src/foreground.cpp
  src/tracks.cpp
)
target_include_directories(haus_vision_core PUBLIC include)
target_compile_options(haus_vision_core PRIVATE -Wall -Wextra -Wpedantic -O3)

add_executable(haus-vision-worker src/main.cpp)
target_link_libraries(haus-vision-worker PRIVATE haus_vision_core)
target_compile_options(haus-vision-worker PRIVATE -Wall -Wextra -Wpedantic -O3)

add_executable(haus-vision-test tests/test_vision.cpp)
target_link_libraries(haus-vision-test PRIVATE haus_vision_core)
target_compile_options(haus-vision-test PRIVATE -Wall -Wextra -Wpedantic -O3)
