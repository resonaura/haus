/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 only; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-only.
 */

#pragma once

#include <cstdint>
#include <cstddef>
#include <vector>
#include "protocol.hpp"

namespace tuya {

class TuyaCipher {
public:
    static uint32_t crc32(const uint8_t* data, size_t len);

    static std::vector<uint8_t> build_tuya_frame(TuyaCmdType type, const uint8_t* payload, size_t len, uint32_t seq,
                                                 const uint8_t* local_key = nullptr);

    static bool parse_tuya_frame(const uint8_t* data, size_t len, uint32_t& out_seq, TuyaCmdType& out_cmd,
                                 std::vector<uint8_t>& out_payload, const uint8_t* local_key = nullptr);
};

}  // namespace tuya
