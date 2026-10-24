"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Opaque HomeKit serial numbers.
 *
 * HomeKit shows SerialNumber in the Home app, so it ends up in screenshots and
 * bug reports. A random value generated once and persisted in accessory
 * context is stable across restarts without disclosing anything.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.newAccessorySerialNumber = newAccessorySerialNumber;
const node_crypto_1 = require("node:crypto");
/** Generate a fresh opaque serial number. */
function newAccessorySerialNumber() {
    return (0, node_crypto_1.randomUUID)();
}
