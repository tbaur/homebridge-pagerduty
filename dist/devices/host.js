"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The contract between an accessory and the platform.
 *
 * An explicit interface rather than a reference to the platform class: it
 * breaks the import cycle, and it is the whole surface an accessory may reach,
 * so a test supplies a dozen-line stand-in.
 *
 * Note what an accessory cannot do through this interface: it cannot send an
 * event or see the routing key. A write only changes desired state. Whether
 * and when anything goes to PagerDuty is decided by the reconciler, so a
 * HomeKit write never waits on PagerDuty.
 */
Object.defineProperty(exports, "__esModule", { value: true });
