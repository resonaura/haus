/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace haus::vision {

constexpr int WIDTH = 320;
constexpr int HEIGHT = 180;
constexpr int CHANNELS = 3;
constexpr int FRAME_SIZE = WIDTH * HEIGHT * CHANNELS;
constexpr int PIXELS = WIDTH * HEIGHT;

struct Rect {
  int x1 = 0;
  int y1 = 0;
  int x2 = 0;
  int y2 = 0;

  [[nodiscard]] int width() const noexcept { return x2 - x1; }
  [[nodiscard]] int height() const noexcept { return y2 - y1; }
  [[nodiscard]] int area() const noexcept { return (x2 > x1 && y2 > y1) ? (x2 - x1) * (y2 - y1) : 0; }
};

struct Point2D {
  float x = 0.0f;
  float y = 0.0f;
};

struct Detection {
  std::string kind;
  float confidence = 1.0f;
  Rect box{};
};

[[nodiscard]] float compute_overlap(const Rect& a, const Rect& b) noexcept;

class MovementTracks {
public:
  MovementTracks() = default;

  [[nodiscard]] bool update(const std::vector<Rect>& boxes);
  void reset() noexcept { tracks_.clear(); }

private:
  struct Track {
    Rect box;
    std::vector<Point2D> points;
  };

  std::vector<Track> tracks_;
};

class ForegroundGate {
public:
  ForegroundGate() = default;

  // Ingests a raw 320x180 BGR24 frame. Returns true if foreground motion is present.
  bool update(const uint8_t* bgr_data, std::vector<Rect>& moving_boxes);
  [[nodiscard]] int frame_count() const noexcept { return frames_; }
  void reset() noexcept;

private:
  std::vector<float> background_;
  std::vector<uint8_t> gray_blurred_;
  std::vector<uint8_t> mask_;
  int frames_ = 0;
  int held_ = 0;
};

class MotionAnalyzer {
public:
  explicit MotionAnalyzer(std::string mode = "motion") : mode_(std::move(mode)) {}

  std::vector<Detection> analyze(const uint8_t* bgr_data, bool& calibrated);
  [[nodiscard]] bool is_calibrated() const noexcept { return gate_.frame_count() > 4; }

private:
  std::string mode_;
  ForegroundGate gate_;
  MovementTracks tracks_;
  std::vector<uint8_t> previous_frame_;
};

} // namespace haus::vision
