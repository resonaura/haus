/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

#include "vision.hpp"
#include <chrono>
#include <iostream>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>
#endif

int main(int argc, char* argv[]) {
#if defined(_WIN32)
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif

  std::ios_base::sync_with_stdio(false);
  std::cin.tie(nullptr);

  std::string mode = "motion";
  if (argc > 1 && argv[1] != nullptr) {
    mode = argv[1];
  }

  haus::vision::MotionAnalyzer analyzer(mode);

  // Ready handshake signal
  std::cout << "{\"type\":\"ready\"}\n" << std::flush;

  std::vector<uint8_t> buffer(haus::vision::FRAME_SIZE);

  while (std::cin.read(reinterpret_cast<char*>(buffer.data()), haus::vision::FRAME_SIZE)) {
    const auto start = std::chrono::steady_clock::now();

    bool calibrated = false;
    const auto detections = analyzer.analyze(buffer.data(), calibrated);

    const auto elapsed = std::chrono::steady_clock::now() - start;
    const int processing_ms = static_cast<int>(
      std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count()
    );

    std::cout << "{\"type\":\"frame\",\"calibrated\":" << (calibrated ? "true" : "false")
              << ",\"processingMs\":" << processing_ms << ",\"detections\":[";

    for (size_t i = 0; i < detections.size(); ++i) {
      if (i > 0) std::cout << ",";
      const auto& det = detections[i];
      std::cout << "{\"kind\":\"" << det.kind << "\",\"confidence\":" << det.confidence
                << ",\"box\":[" << det.box.x1 << "," << det.box.y1 << "," << det.box.x2
                << "," << det.box.y2 << "]}";
    }

    std::cout << "]}\n" << std::flush;
  }

  return 0;
}
