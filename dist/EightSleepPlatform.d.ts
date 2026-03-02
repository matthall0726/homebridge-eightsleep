import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
export declare class EightSleepPlatform implements DynamicPlatformPlugin {
    readonly log: Logger;
    readonly config: PlatformConfig;
    readonly homebridgeApi: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    private readonly api;
    private readonly accessories;
    private readonly sideStates;
    private readonly pollingInterval;
    constructor(log: Logger, config: PlatformConfig, homebridgeApi: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private discoverDevices;
    private setupThermostat;
    private startPolling;
}
