/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

#include "vision.hpp"
#include <cassert>
#include <iostream>
#include <random>
#include <vector>

namespace {

using namespace haus::vision;

void test_calibration_warmup() {
  MotionAnalyzer analyzer("motion");
  std::vector<uint8_t> frame(FRAME_SIZE, 35);

  std::vector<bool> calibration_history;
  for (int i = 0; i < 5; ++i) {
    // slightly perturb to avoid keyframe repetition rejection
    frame[0] = static_cast<uint8_t>(35 + i);
    bool calibrated = false;
    const auto detections = analyzer.analyze(frame.data(), calibrated);
    calibration_history.push_back(calibrated);
    assert(detections.empty());
  }

  assert(!calibration_history[0]);
  assert(!calibration_history[1]);
  assert(!calibration_history[2]);
  assert(!calibration_history[3]);
  assert(calibration_history[4]);
  std::cout << "PASS: test_calibration_warmup\n";
}

void test_noise_and_exposure_changes_do_not_trigger() {
  ForegroundGate gate;
  std::mt19937 rng(12);
  std::normal_distribution<float> dist(0.0f, 2.0f);

  std::vector<Rect> boxes;
  for (int i = 0; i < 30; ++i) {
    const float level = (i < 15) ? 40.0f : 100.0f;
    std::vector<uint8_t> frame(FRAME_SIZE);
    for (int p = 0; p < PIXELS; ++p) {
      const float val = std::clamp(level + dist(rng), 0.0f, 255.0f);
      const auto b = static_cast<uint8_t>(val);
      frame[p * 3 + 0] = b;
      frame[p * 3 + 1] = b;
      frame[p * 3 + 2] = b;
    }
    const bool moving = gate.update(frame.data(), boxes);
    assert(!moving);
  }
  std::cout << "PASS: test_noise_and_exposure_changes_do_not_trigger\n";
}

void test_persistent_local_motion_is_detected() {
  MotionAnalyzer analyzer("motion");
  std::vector<uint8_t> background(FRAME_SIZE, 35);

  // Warm up gate
  for (int i = 0; i < 6; ++i) {
    background[0] = static_cast<uint8_t>(35 + (i % 2));
    bool calibrated = false;
    const auto detections = analyzer.analyze(background.data(), calibrated);
    assert(detections.empty());
  }

  // Move a 35x45 rectangle across the frame over 8 steps
  bool detected_motion = false;
  for (int step = 0; step < 8; ++step) {
    std::vector<uint8_t> frame = background;
    const int start_x = 30 + step * 8;
    const int end_x = 65 + step * 8;
    for (int y = 50; y < 95; ++y) {
      for (int x = start_x; x < end_x; ++x) {
        const int p = y * WIDTH + x;
        frame[p * 3 + 0] = 200;
        frame[p * 3 + 1] = 200;
        frame[p * 3 + 2] = 200;
      }
    }
    bool calibrated = false;
    const auto detections = analyzer.analyze(frame.data(), calibrated);
    for (const auto& det : detections) {
      if (det.kind == "motion") {
        detected_motion = true;
      }
    }
  }

  assert(detected_motion);
  std::cout << "PASS: test_persistent_local_motion_is_detected\n";
}

void test_swaying_blob_does_not_become_sustained_travel() {
  MovementTracks tracks;
  for (int i = 0; i < 40; ++i) {
    const int x = 90 + ((i % 2 == 0) ? 3 : -3);
    std::vector<Rect> boxes;
    boxes.push_back(Rect{.x1 = x, .y1 = 40, .x2 = x + 25, .y2 = 65});
    const bool detected = tracks.update(boxes);
    assert(!detected);
  }
  std::cout << "PASS: test_swaying_blob_does_not_become_sustained_travel\n";
}

void test_coherent_small_object_travel_survives_sway_filter() {
  MovementTracks tracks;
  bool detected = false;
  for (int i = 0; i < 8; ++i) {
    const int x = 30 + i * 8;
    std::vector<Rect> boxes;
    boxes.push_back(Rect{.x1 = x, .y1 = 60, .x2 = x + 25, .y2 = 85});
    if (tracks.update(boxes)) {
      detected = true;
    }
  }
  assert(detected);
  std::cout << "PASS: test_coherent_small_object_travel_survives_sway_filter\n";
}

} // namespace

int main() {
  std::cout << "Running Haus C++23 native vision test suite...\n";
  test_calibration_warmup();
  test_noise_and_exposure_changes_do_not_trigger();
  test_persistent_local_motion_is_detected();
  test_swaying_blob_does_not_become_sustained_travel();
  test_coherent_small_object_travel_survives_sway_filter();
  std::cout << "All 5 native vision test suites passed successfully!\n";
  return 0;
}
