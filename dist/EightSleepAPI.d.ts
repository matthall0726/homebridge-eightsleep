import { Logger } from 'homebridge';
export interface TemperatureStatus {
    currentLevel: number;
    currentDeviceLevel: number;
    currentState: {
        type: string;
    };
}
export interface BedSide {
    userId: string;
    side: 'left' | 'right';
}
export interface DiscoveryResult {
    deviceId: string;
    sides: BedSide[];
}
export declare class EightSleepAPI {
    private readonly email;
    private readonly password;
    private readonly log;
    private accessToken;
    private tokenExpiry;
    private authUserId;
    private deviceId;
    constructor(email: string, password: string, log: Logger);
    private request;
    authenticate(): Promise<void>;
    discover(): Promise<DiscoveryResult>;
    getTemperature(userId: string): Promise<TemperatureStatus>;
    setTemperature(userId: string, level: number): Promise<void>;
    turnOn(userId: string): Promise<void>;
    turnOff(userId: string): Promise<void>;
    static levelToCelsius(level: number): number;
    static celsiusToLevel(c: number): number;
}
