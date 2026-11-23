# Haus — A thoughtful home.
# Copyright © 2026 Andrii Vynohradov. All rights reserved.
# Licensed under the GNU General Public License v3.0 or later; see LICENSE.
# SPDX-License-Identifier: GPL-3.0-or-later.

cmake_minimum_required(VERSION 3.16)
project(haus_icons VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Threads REQUIRED)

add_executable(
  haus-icon-worker
  src/main.cpp
  src/outpaint.cpp
  src/preprocess.cpp
  src/segment.cpp
  src/render.cpp
  src/composite.cpp
)
target_include_directories(haus-icon-worker PRIVATE src)
target_link_libraries(haus-icon-worker PRIVATE Threads::Threads)
target_compile_options(haus-icon-worker PRIVATE -Wall -Wextra -Wpedantic -O3)
