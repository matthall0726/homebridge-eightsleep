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
        this.sideStates = new Map();
        this.Service = this.homebridgeApi.hap.Service;
        this.Characteristic = this.homebridgeApi.hap.Characteristic;
        const cfg = config;
        this.pollingInterval = (cfg.pollingInterval || 60) * 1000;
        this.api = new EightSleepAPI_1.EightSleepAPI(cfg.email, cfg.password, this.log);
        this.homebridgeApi.on('didFinishLaunching', () => {
            this.discoverDevices();
        });
    }
    configureAccessory(accessory) {
        this.accessories.push(accessory);
    }
    async discoverDevices() {
        try {
            const discovery = await this.api.discover();
            for (const bedSide of discovery.sides) {
                const uuid = this.homebridgeApi.hap.uuid.generate(`eightsleep-${discovery.deviceId}-${bedSide.side}`);
                const displayName = `Eight Sleep (${bedSide.side})`;
                this.sideStates.set(uuid, {
                    userId: bedSide.userId,
                    side: bedSide.side,
                    currentLevel: 0,
                    isOn: false,
                });
                const existing = this.accessories.find(a => a.UUID === uuid);
                if (existing) {
                    this.log.info('Restoring accessory:', displayName);
                    this.setupThermostat(existing, uuid);
                }
                else {
                    this.log.info('Adding accessory:', displayName);
                    const accessory = new this.homebridgeApi.platformAccessory(displayName, uuid);
                    accessory.context.deviceId = discovery.deviceId;
                    accessory.context.userId = bedSide.userId;
                    accessory.context.side = bedSide.side;
                    this.setupThermostat(accessory, uuid);
                    this.homebridgeApi.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
                    this.accessories.push(accessory);
                }
            }
            // Remove stale accessories for sides that no longer exist
            const validUUIDs = discovery.sides.map(s => this.homebridgeApi.hap.uuid.generate(`eightsleep-${discovery.deviceId}-${s.side}`));
            const stale = this.accessories.filter(a => !validUUIDs.includes(a.UUID));
            if (stale.length > 0) {
                this.homebridgeApi.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, stale);
            }
            this.startPolling();
        }
        catch (err) {
            this.log.error('Failed to discover Eight Sleep devices:', err.message);
        }
    }
    setupThermostat(accessory, uuid) {
        const state = this.sideStates.get(uuid);
        const infoService = accessory.getService(this.Service.AccessoryInformation)
            || accessory.addService(this.Service.AccessoryInformation);
        infoService
            .setCharacteristic(this.Characteristic.Manufacturer, 'Eight Sleep')
            .setCharacteristic(this.Characteristic.Model, 'Pod')
            .setCharacteristic(this.Characteristic.SerialNumber, `${accessory.context.deviceId}-${state.side}`);
        // Remove any leftover services from previous versions
        const occupancy = accessory.getService(this.Service.OccupancySensor);
        if (occupancy) {
            accessory.removeService(occupancy);
        }
        for (const svc of accessory.services.filter(s => s.UUID === this.Service.Switch.UUID)) {
            accessory.removeService(svc);
        }
        const thermostat = accessory.getService(this.Service.Thermostat)
            || accessory.addService(this.Service.Thermostat, `Temperature (${state.side})`);
        thermostat.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
            .onGet(() => {
            if (!state.isOn) {
                return this.Characteristic.CurrentHeatingCoolingState.OFF;
            }
            return state.currentLevel < 0
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
            return state.isOn
                ? this.Characteristic.TargetHeatingCoolingState.AUTO
                : this.Characteristic.TargetHeatingCoolingState.OFF;
        })
            .onSet(async (value) => {
            try {
                if (value === this.Characteristic.TargetHeatingCoolingState.OFF) {
                    await this.api.turnOff(state.userId);
                    state.isOn = false;
                }
                else {
                    await this.api.turnOn(state.userId);
                    state.isOn = true;
                }
            }
            catch (err) {
                this.log.error(`Failed to set power (${state.side}):`, err.message);
            }
        });
        thermostat.getCharacteristic(this.Characteristic.CurrentTemperature)
            .setProps({ minValue: 13, maxValue: 44, minStep: 0.5 })
            .onGet(() => EightSleepAPI_1.EightSleepAPI.levelToCelsius(state.currentLevel));
        thermostat.getCharacteristic(this.Characteristic.TargetTemperature)
            .setProps({ minValue: 13, maxValue: 44, minStep: 0.5 })
            .onGet(() => EightSleepAPI_1.EightSleepAPI.levelToCelsius(state.currentLevel))
            .onSet(async (value) => {
            try {
                const level = EightSleepAPI_1.EightSleepAPI.celsiusToLevel(value);
                await this.api.setTemperature(state.userId, level);
                state.currentLevel = level;
            }
            catch (err) {
                this.log.error(`Failed to set temperature (${state.side}):`, err.message);
            }
        });
        thermostat.getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
            .onGet(() => this.Characteristic.TemperatureDisplayUnits.CELSIUS)
            .onSet(() => { });
    }
    startPolling() {
        setInterval(async () => {
            for (const accessory of this.accessories) {
                const state = this.sideStates.get(accessory.UUID);
                if (!state) {
                    continue;
                }
                try {
                    const temp = await this.api.getTemperature(state.userId);
                    state.currentLevel = temp.currentLevel;
                    state.isOn = temp.currentState?.type !== 'off';
                    const thermostat = accessory.getService(this.Service.Thermostat);
                    if (thermostat) {
                        thermostat.updateCharacteristic(this.Characteristic.CurrentTemperature, EightSleepAPI_1.EightSleepAPI.levelToCelsius(state.currentLevel));
                        thermostat.updateCharacteristic(this.Characteristic.CurrentHeatingCoolingState, !state.isOn
                            ? this.Characteristic.CurrentHeatingCoolingState.OFF
                            : state.currentLevel < 0
                                ? this.Characteristic.CurrentHeatingCoolingState.COOL
                                : this.Characteristic.CurrentHeatingCoolingState.HEAT);
                    }
                }
                catch (err) {
                    this.log.error(`Polling error (${state.side}):`, err.message);
                }
            }
        }, this.pollingInterval);
    }
}
exports.EightSleepPlatform = EightSleepPlatform;
