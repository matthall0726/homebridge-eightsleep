import { API } from 'homebridge';
import { EightSleepPlatform } from './EightSleepPlatform';
import { PLATFORM_NAME } from './settings';

module.exports = (api: API) => {
  api.registerPlatform(PLATFORM_NAME, EightSleepPlatform);
};
