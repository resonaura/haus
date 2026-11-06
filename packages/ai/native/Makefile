# Haus — A thoughtful home.
# Copyright © 2026 Andrii Vynohradov. All rights reserved.
# Licensed under the GNU General Public License v3.0 or later; see LICENSE.
# SPDX-License-Identifier: GPL-3.0-or-later.

CXX ?= clang++
CXXFLAGS ?= -std=c++23 -O3 -Wall -Wextra -Wpedantic -Iinclude

BUILD_DIR ?= ../dist/bin
OBJ_DIR ?= obj

CORE_SRCS = src/foreground.cpp src/tracks.cpp
CORE_OBJS = $(OBJ_DIR)/foreground.o $(OBJ_DIR)/tracks.o

.PHONY: all clean test

all: $(BUILD_DIR)/haus-vision-worker $(BUILD_DIR)/haus-vision-test

$(OBJ_DIR):
	mkdir -p $(OBJ_DIR)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(OBJ_DIR)/foreground.o: src/foreground.cpp include/vision.hpp | $(OBJ_DIR)
	$(CXX) $(CXXFLAGS) -c src/foreground.cpp -o $@

$(OBJ_DIR)/tracks.o: src/tracks.cpp include/vision.hpp | $(OBJ_DIR)
	$(CXX) $(CXXFLAGS) -c src/tracks.cpp -o $@

$(BUILD_DIR)/haus-vision-worker: src/main.cpp $(CORE_OBJS) | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) src/main.cpp $(CORE_OBJS) -o $@

$(BUILD_DIR)/haus-vision-test: tests/test_vision.cpp $(CORE_OBJS) | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) tests/test_vision.cpp $(CORE_OBJS) -o $@

test: $(BUILD_DIR)/haus-vision-test
	$(BUILD_DIR)/haus-vision-test

clean:
	rm -rf $(OBJ_DIR) $(BUILD_DIR)/haus-vision-worker $(BUILD_DIR)/haus-vision-test
