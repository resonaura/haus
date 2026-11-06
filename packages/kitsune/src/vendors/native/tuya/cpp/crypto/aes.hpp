/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 only; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-only.
 */

#pragma once

#include <cstdint>
#include <cstddef>
#include <vector>

namespace tuya {

class AES128 {
public:
    static std::vector<uint8_t> decrypt_cbc(const uint8_t* key, const uint8_t* iv, const uint8_t* data, size_t len);
    static std::vector<uint8_t> encrypt_cbc(const uint8_t* key, const uint8_t* iv, const uint8_t* data, size_t len);
    static std::vector<uint8_t> decrypt_ecb(const uint8_t* key, const uint8_t* data, size_t len);
    static std::vector<uint8_t> encrypt_ecb(const uint8_t* key, const uint8_t* data, size_t len);
};

}  // namespace tuya
