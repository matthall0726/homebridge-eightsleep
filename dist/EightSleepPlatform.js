"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EightSleepPlatform = void 0;
const EightSleepAPI_1 = require("./EightSleepAPI");
const settings_1 = require("./settings");
class EightSleepPlatform {
    constructor(log, config, homebridgeApi) {
        this.log = log;
        this.config = config;
        this.homebridgeApi = homebridgeApi;
        this.accessories = [];
        // Cached state
        this.currentLevel = 0;
        this.isOn = false;
        this.isPresent = false;
        this.Service = this.homebridgeApi.hap.Service;
        this.Characteristic = this.homebridgeApi.hap.Characteristic;
        const cfg = config;
        this.pollingInterval = (cfg.pollingInterval || 60) * 1000;
        this.api = new EightSleepAPI_1.EightSleepAPI(cfg.email, cfg.password, this.log);
        this.homebridgeApi.on('didFinishLaunching', () => {
            this.log.info('Eight Sleep platform finished launching');
            this.discoverDevices();
        });
    }
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        this.accessories.push(accessory);
    }
    async discoverDevices() {
        try {
            const info = await this.api.discover();
            const uuid = this.homebridgeApi.hap.uuid.generate(`eightsleep-${info.deviceId}-${info.side}`);
            const displayName = `Eight Sleep (${info.side})`;
            const existing = this.accessories.find(a => a.UUID === uuid);
            if (existing) {
                this.log.info('Restoring existing accessory:', displayName);
                this.setupServices(existing);
            }
            else {
                this.log.info('Adding new accessory:', displayName);
                const accessory = new this.homebridgeApi.platformAccessory(displayName, uuid);
                accessory.context.deviceId = info.deviceId;
                accessory.context.userId = info.userId;
                accessory.context.side = info.side;
                this.setupServices(accessory);
                this.homebridgeApi.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
                this.accessories.push(accessory);
            }
            this.startPolling();
        }
        catch (err) {
            this.log.error('Failed to discover Eight Sleep devices:', err.message);
        }
    }
    setupServices(accessory) {
        // --- Accessory Information ---
        const infoService = accessory.getService(this.Service.AccessoryInformation)
            || accessory.addService(this.Service.AccessoryInformation);
        infoService
            .setCharacteristic(this.Characteristic.Manufacturer, 'Eight Sleep')
            .setCharacteristic(this.Characteristic.Model, 'Pod')
            .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.deviceId || 'Unknown');
        // --- Thermostat (main temperature control) ---
        const thermostat = accessory.getService(this.Service.Thermostat)
            || accessory.addService(this.Service.Thermostat, 'Temperature Control');
        // Heating/Cooling state: OFF or AUTO (smart mode)
        thermostat.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
            .onGet(() => {
            if (!this.isOn) {
                return this.Characteristic.CurrentHeatingCoolingState.OFF;
            }
            return this.currentLevel < 0
                ? this.Characteristic.CurrentHeatingCoolingState.COOL
                : this.Characteristic.CurrentHeatingCoolingState.HEAT;
        });
        thermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
            .setProps({
            validValues: [
                this.Characteristic.TargetHeatingCoolingState.OFF,
                this.Characteristic.TargetHeatingCoolingState.AUTO,
            ],
        })
            .onGet(() => {
            return this.isOn
                ? this.Characteristic.TargetHeatingCoolingState.AUTO
                : this.Characteristic.TargetHeatingCoolingState.OFF;
        })
            .onSet(async (value) => {
            try {
                if (value === this.Characteristic.TargetHeatingCoolingState.OFF) {
                    await this.api.turnOff();
                    this.isOn = false;
                }
                else {
                    await this.api.turnOn();
                    this.isOn = true;
                }
            }
            catch (err) {
                this.log.error('Failed to set power state:', err.message);
            }
        });
        // Temperature: Map Eight Sleep level (-100..100) to Celsius (13..44)
        thermostat.getCharacteristic(this.Characteristic.CurrentTemperature)
            .setProps({ minValue: 13, maxValue: 44, minStep: 0.5 })
            .onGet(() => EightSleepAPI_1.EightSleepAPI.levelToCelsius(this.currentLevel));
        thermostat.getCharacteristic(this.Characteristic.TargetTemperature)
            .setProps({ minValue: 13, maxValue: 44, minStep: 0.5 })
            .onGet(() => EightSleepAPI_1.EightSleepAPI.levelToCelsius(this.currentLevel))
            .onSet(async (value) => {
            try {
                const level = EightSleepAPI_1.EightSleepAPI.celsiusToLevel(value);
                await this.api.setTemperature(level);
                this.currentLevel = level;
            }
            catch (err) {
                this.log.error('Failed to set temperature:', err.message);
            }
        });
        thermostat.getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
            .onGet(() => this.Characteristic.TemperatureDisplayUnits.CELSIUS)
            .onSet(() => { });
        // --- Occupancy Sensor (presence detection) ---
        const occupancy = accessory.getService(this.Service.OccupancySensor)
            || accessory.addService(this.Service.OccupancySensor, 'Bed Presence');
        occupancy.getCharacteristic(this.Characteristic.OccupancyDetected)
            .onGet(() => {
            return this.isPresent
                ? this.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
                : this.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
        });
        // --- Switch: Nap Mode ---
        const napSwitch = accessory.getService('Nap Mode')
            || accessory.addService(this.Service.Switch, 'Nap Mode', 'nap-mode');
        let napModeOn = false;
        napSwitch.getCharacteristic(this.Characteristic.On)
            .onGet(() => napModeOn)
            .onSet(async (value) => {
            try {
                if (value) {
                    await this.api.activateNapMode();
                }
                else {
                    await this.api.deactivateNapMode();
                }
                napModeOn = value;
            }
            catch (err) {
                this.log.error('Failed to toggle nap mode:', err.message);
            }
        });
        // --- Switch: Away Mode ---
        const awaySwitch = accessory.getService('Away Mode')
            || accessory.addService(this.Service.Switch, 'Away Mode', 'away-mode');
        let awayModeOn = false;
        awaySwitch.getCharacteristic(this.Characteristic.On)
            .onGet(() => awayModeOn)
            .onSet(async (value) => {
            try {
                await this.api.setAwayMode(value);
                awayModeOn = value;
            }
            catch (err) {
                this.log.error('Failed to toggle away mode:', err.message);
            }
        });
    }
    startPolling() {
        this.pollTimer = setInterval(async () => {
            try {
                const temp = await this.api.getTemperature();
                this.currentLevel = temp.currentLevel;
                this.isOn = temp.currentState.type !== 'off';
                const presence = await this.api.getPresence();
                this.isPresent = presence;
                // Push updates to HomeKit
                for (const accessory of this.accessories) {
                    const thermostat = accessory.getService(this.Service.Thermostat);
                    if (thermostat) {
                        thermostat.updateCharacteristic(this.Characteristic.CurrentTemperature, EightSleepAPI_1.EightSleepAPI.levelToCelsius(this.currentLevel));
                        thermostat.updateCharacteristic(this.Characteristic.CurrentHeatingCoolingState, !this.isOn
                            ? this.Characteristic.CurrentHeatingCoolingState.OFF
                            : this.currentLevel < 0
                                ? this.Characteristic.CurrentHeatingCoolingState.COOL
                                : this.Characteristic.CurrentHeatingCoolingState.HEAT);
                    }
                    const occupancy = accessory.getService(this.Service.OccupancySensor);
                    if (occupancy) {
                        occupancy.updateCharacteristic(this.Characteristic.OccupancyDetected, this.isPresent
                            ? this.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
                            : this.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
                    }
                }
            }
            catch (err) {
                this.log.error('Polling error:', err.message);
            }
        }, this.pollingInterval);
    }
}
exports.EightSleepPlatform = EightSleepPlatform;
