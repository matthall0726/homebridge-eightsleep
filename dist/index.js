"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const EightSleepPlatform_1 = require("./EightSleepPlatform");
const settings_1 = require("./settings");
exports.default = (api) => {
    api.registerPlatform(settings_1.PLATFORM_NAME, EightSleepPlatform_1.EightSleepPlatform);
};
