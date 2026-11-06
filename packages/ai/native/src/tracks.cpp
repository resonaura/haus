/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

#include "vision.hpp"
#include <algorithm>
#include <cmath>

namespace haus::vision {

float compute_overlap(const Rect& a, const Rect& b) noexcept {
  const int x1 = std::max(a.x1, b.x1);
  const int y1 = std::max(a.y1, b.y1);
  const int x2 = std::min(a.x2, b.x2);
  const int y2 = std::min(a.y2, b.y2);

  const int intersection_w = std::max(0, x2 - x1);
  const int intersection_h = std::max(0, y2 - y1);
  const int intersection = intersection_w * intersection_h;

  if (intersection <= 0) return 0.0f;

  const int area_a = (a.x2 - a.x1) * (a.y2 - a.y1);
  const int area_b = (b.x2 - b.x1) * (b.y2 - b.y1);
  const int union_area = area_a + area_b - intersection;

  return (union_area > 0) ? static_cast<float>(intersection) / static_cast<float>(union_area) : 0.0f;
}

bool MovementTracks::update(const std::vector<Rect>& boxes) {
  std::vector<Track> next_tracks;
  bool detected = false;

  for (const auto& box : boxes) {
    float best_overlap = 0.0f;
    const Track* best_prev = nullptr;

    for (const auto& prev : tracks_) {
      const float ov = compute_overlap(prev.box, box);
      if (ov > best_overlap) {
        best_overlap = ov;
        best_prev = &prev;
      }
    }

    const Point2D center{
      static_cast<float>(box.x1 + box.x2) * 0.5f,
      static_cast<float>(box.y1 + box.y2) * 0.5f,
    };

    Track new_track;
    new_track.box = box;

    if (best_prev != nullptr && best_overlap > 0.1f) {
      new_track.points = best_prev->points;
      new_track.points.push_back(center);
      if (new_track.points.size() > 5) {
        new_track.points.erase(new_track.points.begin());
      }
    } else {
      new_track.points.push_back(center);
    }

    if (new_track.points.size() >= 3) {
      const auto& p_start = new_track.points.front();
      const auto& p_end = new_track.points.back();
      const float dx = p_end.x - p_start.x;
      const float dy = p_end.y - p_start.y;
      const float distance = std::sqrt(dx * dx + dy * dy);

      float path = 0.0f;
      for (size_t i = 1; i < new_track.points.size(); ++i) {
        const float seg_dx = new_track.points[i].x - new_track.points[i - 1].x;
        const float seg_dy = new_track.points[i].y - new_track.points[i - 1].y;
        path += std::sqrt(seg_dx * seg_dx + seg_dy * seg_dy);
      }

      if (distance >= 12.0f && (distance / std::max(1.0f, path)) >= 0.65f) {
        detected = true;
      }
    }

    next_tracks.push_back(std::move(new_track));
  }

  tracks_ = std::move(next_tracks);
  return detected;
}

} // namespace haus::vision
