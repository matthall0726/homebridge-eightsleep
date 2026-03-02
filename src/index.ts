import { API } from 'homebridge';
import { EightSleepPlatform } from './EightSleepPlatform';
import { PLATFORM_NAME } from './settings';

export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, EightSleepPlatform);
};
