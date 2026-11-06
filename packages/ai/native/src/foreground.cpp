/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

#include "vision.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace haus::vision {

namespace {

void bgr_to_gray(const uint8_t* bgr, uint8_t* gray) noexcept {
  for (int i = 0; i < PIXELS; ++i) {
    const int b = bgr[i * 3 + 0];
    const int g = bgr[i * 3 + 1];
    const int r = bgr[i * 3 + 2];
    gray[i] = static_cast<uint8_t>((29 * b + 150 * g + 77 * r) >> 8);
  }
}

// 5x5 Gaussian blur with 1D kernel [1, 4, 6, 4, 1] / 16
void gaussian_blur_5x5(const uint8_t* src, uint8_t* dst) {
  std::vector<uint16_t> temp(PIXELS);

  // Horizontal pass
  for (int y = 0; y < HEIGHT; ++y) {
    const int row = y * WIDTH;
    for (int x = 0; x < WIDTH; ++x) {
      const int xm2 = std::max(0, x - 2);
      const int xm1 = std::max(0, x - 1);
      const int xp1 = std::min(WIDTH - 1, x + 1);
      const int xp2 = std::min(WIDTH - 1, x + 2);

      const uint16_t val = static_cast<uint16_t>(
        src[row + xm2] + 4 * src[row + xm1] + 6 * src[row + x] + 4 * src[row + xp1] + src[row + xp2]
      );
      temp[row + x] = val;
    }
  }

  // Vertical pass
  for (int y = 0; y < HEIGHT; ++y) {
    const int ym2 = std::max(0, y - 2) * WIDTH;
    const int ym1 = std::max(0, y - 1) * WIDTH;
    const int y0 = y * WIDTH;
    const int yp1 = std::min(HEIGHT - 1, y + 1) * WIDTH;
    const int yp2 = std::min(HEIGHT - 1, y + 2) * WIDTH;

    for (int x = 0; x < WIDTH; ++x) {
      const uint32_t val = temp[ym2 + x] + 4 * temp[ym1 + x] + 6 * temp[y0 + x] +
                           4 * temp[yp1 + x] + temp[yp2 + x];
      dst[y0 + x] = static_cast<uint8_t>(val >> 8); // divide by 256
    }
  }
}

// 3x3 Morphological Open (Erode then Dilate)
void morphology_open_3x3(const uint8_t* src, uint8_t* dst) {
  std::vector<uint8_t> eroded(PIXELS, 0);

  // Erode
  for (int y = 1; y < HEIGHT - 1; ++y) {
    const int row = y * WIDTH;
    for (int x = 1; x < WIDTH - 1; ++x) {
      if (src[row + x] == 255 &&
          src[row - WIDTH + x - 1] == 255 && src[row - WIDTH + x] == 255 && src[row - WIDTH + x + 1] == 255 &&
          src[row + x - 1] == 255 && src[row + x + 1] == 255 &&
          src[row + WIDTH + x - 1] == 255 && src[row + WIDTH + x] == 255 && src[row + WIDTH + x + 1] == 255) {
        eroded[row + x] = 255;
      }
    }
  }

  // Dilate
  std::memset(dst, 0, PIXELS);
  for (int y = 1; y < HEIGHT - 1; ++y) {
    const int row = y * WIDTH;
    for (int x = 1; x < WIDTH - 1; ++x) {
      if (eroded[row + x] == 255) {
        dst[row - WIDTH + x - 1] = 255;
        dst[row - WIDTH + x] = 255;
        dst[row - WIDTH + x + 1] = 255;
        dst[row + x - 1] = 255;
        dst[row + x] = 255;
        dst[row + x + 1] = 255;
        dst[row + WIDTH + x - 1] = 255;
        dst[row + WIDTH + x] = 255;
        dst[row + WIDTH + x + 1] = 255;
      }
    }
  }
}

struct Component {
  Rect box;
  int area = 0;
};

// Connected components extraction for 255 pixels
std::vector<Component> extract_components(const uint8_t* mask) {
  std::vector<int> labels(PIXELS, 0);
  std::vector<Component> components;
  int next_label = 1;

  std::vector<int> queue;
  queue.reserve(1024);

  for (int y = 0; y < HEIGHT; ++y) {
    const int row = y * WIDTH;
    for (int x = 0; x < WIDTH; ++x) {
      const int idx = row + x;
      if (mask[idx] != 255 || labels[idx] != 0) continue;

      const int cur_label = next_label++;
      labels[idx] = cur_label;
      queue.clear();
      queue.push_back(idx);

      int min_x = x, max_x = x;
      int min_y = y, max_y = y;
      int area = 0;

      size_t head = 0;
      while (head < queue.size()) {
        const int cur_idx = queue[head++];
        const int cy = cur_idx / WIDTH;
        const int cx = cur_idx % WIDTH;
        area++;

        min_x = std::min(min_x, cx);
        max_x = std::max(max_x, cx);
        min_y = std::min(min_y, cy);
        max_y = std::max(max_y, cy);

        // 4-connectivity
        const int neighbors[4][2] = {{cx - 1, cy}, {cx + 1, cy}, {cx, cy - 1}, {cx, cy + 1}};
        for (const auto& [nx, ny] : neighbors) {
          if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) {
            const int n_idx = ny * WIDTH + nx;
            if (mask[n_idx] == 255 && labels[n_idx] == 0) {
              labels[n_idx] = cur_label;
              queue.push_back(n_idx);
            }
          }
        }
      }

      components.push_back({
        .box = Rect{.x1 = min_x, .y1 = min_y, .x2 = max_x + 1, .y2 = max_y + 1},
        .area = area,
      });
    }
  }

  return components;
}

} // namespace

void ForegroundGate::reset() noexcept {
  background_.clear();
  frames_ = 0;
  held_ = 0;
}

bool ForegroundGate::update(const uint8_t* bgr_data, std::vector<Rect>& moving_boxes) {
  moving_boxes.clear();
  if (gray_blurred_.size() != PIXELS) gray_blurred_.resize(PIXELS);
  if (mask_.size() != PIXELS) mask_.resize(PIXELS);

  std::vector<uint8_t> gray_raw(PIXELS);
  bgr_to_gray(bgr_data, gray_raw.data());
  gaussian_blur_5x5(gray_raw.data(), gray_blurred_.data());

  frames_++;
  if (background_.empty()) {
    background_.resize(PIXELS);
    for (int i = 0; i < PIXELS; ++i) {
      background_[i] = static_cast<float>(gray_blurred_[i]);
    }
    return false;
  }

  std::vector<float> diff(PIXELS);
  for (int i = 0; i < PIXELS; ++i) {
    diff[i] = static_cast<float>(gray_blurred_[i]) - background_[i];
  }

  // Median shift
  std::vector<float> sorted_diff = diff;
  const auto median_it = sorted_diff.begin() + PIXELS / 2;
  std::nth_element(sorted_diff.begin(), median_it, sorted_diff.end());
  const float shift = *median_it;

  // Uniformity
  int uniform_count = 0;
  for (int i = 0; i < PIXELS; ++i) {
    if (std::abs(diff[i] - shift) < 8.0f) {
      uniform_count++;
    }
  }
  const float uniform = static_cast<float>(uniform_count) / static_cast<float>(PIXELS);

  // Reject sudden exposure changes / lights switching
  if (std::abs(shift) > 12.0f && uniform > 0.8f) {
    for (int i = 0; i < PIXELS; ++i) {
      background_[i] = static_cast<float>(gray_blurred_[i]);
    }
    held_ = 0;
    return false;
  }

  // Noise floor: 25th percentile of abs difference from shift
  std::vector<float> abs_diff(PIXELS);
  for (int i = 0; i < PIXELS; ++i) {
    abs_diff[i] = std::abs(diff[i] - shift);
  }
  std::vector<float> sorted_abs = abs_diff;
  const auto p25_it = sorted_abs.begin() + PIXELS / 4;
  std::nth_element(sorted_abs.begin(), p25_it, sorted_abs.end());
  const float noise = *p25_it;

  const float threshold = std::max(12.0f, noise * 3.0f + 6.0f);
  std::vector<uint8_t> raw_mask(PIXELS, 0);
  for (int i = 0; i < PIXELS; ++i) {
    if (abs_diff[i] > threshold) {
      raw_mask[i] = 255;
    }
  }

  morphology_open_3x3(raw_mask.data(), mask_.data());
  auto components = extract_components(mask_.data());

  int largest = 0;
  int non_zero = 0;
  for (const auto& comp : components) {
    largest = std::max(largest, comp.area);
    non_zero += comp.area;
  }

  const float ratio = static_cast<float>(non_zero) / static_cast<float>(PIXELS);
  constexpr float min_motion_ratio = 0.002f;
  constexpr float max_motion_ratio = 0.90f;
  const bool moving = (frames_ > 4) && (ratio > min_motion_ratio) && (ratio < max_motion_ratio) &&
                      (largest > static_cast<int>(PIXELS * min_motion_ratio));

  held_ = moving ? (held_ + 1) : 0;
  const float weight = moving ? 0.035f : 0.12f;
  for (int i = 0; i < PIXELS; ++i) {
    background_[i] = (1.0f - weight) * background_[i] + weight * static_cast<float>(gray_blurred_[i]);
  }

  if (held_ >= 2) {
    std::sort(components.begin(), components.end(), [](const Component& a, const Component& b) {
      return a.area > b.area;
    });
    for (size_t i = 0; i < std::min<size_t>(8, components.size()); ++i) {
      if (components[i].area >= static_cast<int>(PIXELS * min_motion_ratio)) {
        moving_boxes.push_back(components[i].box);
      }
    }
    return true;
  }

  return false;
}

std::vector<Detection> MotionAnalyzer::analyze(const uint8_t* bgr_data, bool& calibrated) {
  calibrated = is_calibrated();

  // Low-cost decoder keyframe repetition rejection
  if (previous_frame_.size() == FRAME_SIZE &&
      std::memcmp(previous_frame_.data(), bgr_data, FRAME_SIZE) == 0) {
    return {};
  }
  if (previous_frame_.size() != FRAME_SIZE) previous_frame_.resize(FRAME_SIZE);
  std::memcpy(previous_frame_.data(), bgr_data, FRAME_SIZE);

  std::vector<Rect> moving_boxes;
  const bool has_motion = gate_.update(bgr_data, moving_boxes);
  calibrated = is_calibrated();

  if (!has_motion || moving_boxes.empty()) {
    tracks_.reset();
    return {};
  }

  if (mode_ == "motion" || mode_ == "objects") {
    if (tracks_.update(moving_boxes)) {
      std::vector<Detection> results;
      results.push_back({
        .kind = "motion",
        .confidence = 1.0f,
        .box = moving_boxes.front(),
      });
      return results;
    }
  }

  return {};
}

} // namespace haus::vision
