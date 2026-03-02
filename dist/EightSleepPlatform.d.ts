import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
export declare class EightSleepPlatform implements DynamicPlatformPlugin {
    readonly log: Logger;
    readonly config: PlatformConfig;
    readonly homebridgeApi: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    private readonly api;
    private readonly accessories;
    private pollTimer?;
    private readonly pollingInterval;
    private currentLevel;
    private isOn;
    private isPresent;
    constructor(log: Logger, config: PlatformConfig, homebridgeApi: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private discoverDevices;
    private setupServices;
    private startPolling;
}
