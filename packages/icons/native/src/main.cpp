/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

#include <algorithm>
#include <array>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "render.hpp"

namespace {

constexpr uint32_t kOpRenderAllBase = 1;
constexpr uint32_t kOpCompositeSemantic = 2;
constexpr uint32_t kMaxPayloadBytes = 32u * 1024u * 1024u;

struct Job {
  uint32_t reqId = 0;
  uint32_t opcode = 0;
  std::vector<uint8_t> payload;
};

inline uint32_t readU32LE(const uint8_t* p) noexcept {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
         (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

inline float readF32LE(const uint8_t* p) noexcept {
  const uint32_t bits = readU32LE(p);
  float v = 0.0f;
  std::memcpy(&v, &bits, sizeof(float));
  return v;
}

inline void writeU32LE(uint8_t* p, uint32_t v) noexcept {
  p[0] = static_cast<uint8_t>(v & 0xffu);
  p[1] = static_cast<uint8_t>((v >> 8) & 0xffu);
  p[2] = static_cast<uint8_t>((v >> 16) & 0xffu);
  p[3] = static_cast<uint8_t>((v >> 24) & 0xffu);
}

bool readExact(uint8_t* dst, size_t n) {
  size_t total = 0;
  while (total < n) {
    const size_t got = std::fread(dst + total, 1, n - total, stdin);
    if (got == 0) return false;
    total += got;
  }
  return true;
}

void writeResponse(std::mutex& outMutex, uint32_t reqId, uint32_t status, const uint8_t* data, size_t len) {
  uint8_t header[12];
  writeU32LE(header, reqId);
  writeU32LE(header + 4, status);
  writeU32LE(header + 8, static_cast<uint32_t>(len));
  std::lock_guard<std::mutex> lock(outMutex);
  std::fwrite(header, 1, sizeof(header), stdout);
  if (len > 0) std::fwrite(data, 1, len, stdout);
  std::fflush(stdout);
}

void processJob(const Job& job, std::mutex& outMutex) {
  if (job.opcode == kOpRenderAllBase) {
    if (job.payload.size() < 16) {
      writeResponse(outMutex, job.reqId, 1, nullptr, 0);
      return;
    }
    const int targetSize = static_cast<int>(readU32LE(job.payload.data()));
    const float tileFraction = readF32LE(job.payload.data() + 4);
    const int srcW = static_cast<int>(readU32LE(job.payload.data() + 8));
    const int srcH = static_cast<int>(readU32LE(job.payload.data() + 12));
    const size_t expected = 16u + static_cast<size_t>(srcW) * static_cast<size_t>(srcH) * 4u;
    if (targetSize < 16 || targetSize > 1024 || srcW <= 0 || srcH <= 0 || srcW > 4096 ||
        srcH > 4096 || job.payload.size() != expected) {
      writeResponse(outMutex, job.reqId, 2, nullptr, 0);
      return;
    }
    const auto rendered = haus::icons::renderAllBaseLayersCpp(
        job.payload.data() + 16, srcW, srcH, targetSize, tileFraction);
    const size_t planeBytes = static_cast<size_t>(rendered.width * rendered.height * 4);
    std::vector<uint8_t> out(16u + planeBytes * 4u);
    writeU32LE(out.data(), static_cast<uint32_t>(rendered.width));
    writeU32LE(out.data() + 4, static_cast<uint32_t>(rendered.height));
    writeU32LE(out.data() + 8, static_cast<uint32_t>(rendered.bodySize));
    const uint32_t flags = (rendered.isFill ? 1u : 0u) | (rendered.segmented ? 2u : 0u);
    writeU32LE(out.data() + 12, flags);
    std::memcpy(out.data() + 16, rendered.defaultRgba.data(), planeBytes);
    std::memcpy(out.data() + 16 + planeBytes, rendered.darkRgba.data(), planeBytes);
    std::memcpy(out.data() + 16 + planeBytes * 2, rendered.clearSemanticRgba.data(), planeBytes);
    std::memcpy(out.data() + 16 + planeBytes * 3, rendered.tintedSemanticRgba.data(), planeBytes);
    writeResponse(outMutex, job.reqId, 0, out.data(), out.size());
    return;
  }

  if (job.opcode == kOpCompositeSemantic) {
    if (job.payload.size() < 32) {
      writeResponse(outMutex, job.reqId, 1, nullptr, 0);
      return;
    }
    const bool isTinted = readU32LE(job.payload.data()) != 0;
    const bool isDark = readU32LE(job.payload.data() + 4) != 0;
    const std::array<float, 3> accent{
        readF32LE(job.payload.data() + 8),
        readF32LE(job.payload.data() + 12),
        readF32LE(job.payload.data() + 16),
    };
    const float tileFraction = readF32LE(job.payload.data() + 20);
    const int width = static_cast<int>(readU32LE(job.payload.data() + 24));
    const uint32_t packed = readU32LE(job.payload.data() + 28);
    const int height = static_cast<int>(packed & 0xffffu);
    const int displaySize = std::max(16, static_cast<int>((packed >> 16) & 0xffffu));
    const size_t expected = 32u + static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
    if (width <= 0 || height <= 0 || width > 1024 || height > 1024 || job.payload.size() != expected) {
      writeResponse(outMutex, job.reqId, 2, nullptr, 0);
      return;
    }
    const auto out = haus::icons::compositeSemanticCpp(
        job.payload.data() + 32, width, height, isTinted, isDark, accent, tileFraction, displaySize);
    writeResponse(outMutex, job.reqId, 0, out.data(), out.size());
    return;
  }

  writeResponse(outMutex, job.reqId, 3, nullptr, 0);
}

}  // namespace

int main(int argc, char** argv) {
  int threadCount = static_cast<int>(std::min(4u, std::max(1u, std::thread::hardware_concurrency())));
  for (int i = 1; i + 1 < argc; ++i) {
    if (std::string(argv[i]) == "--threads") {
      threadCount = std::clamp(std::stoi(argv[i + 1]), 1, 16);
    }
  }

  std::mutex queueMutex;
  std::mutex outMutex;
  std::condition_variable queueCv;
  std::deque<Job> queue;
  bool eof = false;

  std::vector<std::thread> workers;
  workers.reserve(static_cast<size_t>(threadCount));
  for (int t = 0; t < threadCount; ++t) {
    workers.emplace_back([&]() {
      while (true) {
        Job job;
        {
          std::unique_lock<std::mutex> lock(queueMutex);
          queueCv.wait(lock, [&]() { return !queue.empty() || eof; });
          if (queue.empty() && eof) return;
          job = std::move(queue.front());
          queue.pop_front();
        }
        processJob(job, outMutex);
      }
    });
  }

  uint8_t hdr[12];
  while (readExact(hdr, sizeof(hdr))) {
    const uint32_t reqId = readU32LE(hdr);
    const uint32_t opcode = readU32LE(hdr + 4);
    const uint32_t payloadLen = readU32LE(hdr + 8);
    if (payloadLen > kMaxPayloadBytes) break;
    Job job;
    job.reqId = reqId;
    job.opcode = opcode;
    job.payload.resize(payloadLen);
    if (payloadLen > 0 && !readExact(job.payload.data(), payloadLen)) break;
    {
      std::lock_guard<std::mutex> lock(queueMutex);
      queue.push_back(std::move(job));
    }
    queueCv.notify_one();
  }

  {
    std::lock_guard<std::mutex> lock(queueMutex);
    eof = true;
  }
  queueCv.notify_all();
  for (auto& worker : workers) worker.join();
  return 0;
}
