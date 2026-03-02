import { Logger } from 'homebridge';
export interface TemperatureStatus {
    currentLevel: number;
    currentDeviceLevel: number;
    currentState: {
        type: string;
    };
}
export interface DeviceStatus {
    leftUserId?: string;
    rightUserId?: string;
}
export declare class EightSleepAPI {
    private readonly email;
    private readonly password;
    private readonly log;
    private accessToken;
    private tokenExpiry;
    private userId;
    private deviceId;
    private side;
    constructor(email: string, password: string, log: Logger);
    private request;
    authenticate(): Promise<void>;
    discover(): Promise<{
        userId: string;
        deviceId: string;
        side: string;
        features: string[];
    }>;
    getUserId(): string;
    getDeviceId(): string;
    turnOn(): Promise<void>;
    turnOff(): Promise<void>;
    getTemperature(): Promise<TemperatureStatus>;
    setTemperature(level: number): Promise<void>;
    getPresence(): Promise<boolean>;
    getDeviceSides(): Promise<DeviceStatus>;
    activateNapMode(): Promise<void>;
    deactivateNapMode(): Promise<void>;
    setAwayMode(away: boolean): Promise<void>;
    static levelToFahrenheit(level: number): number;
    static fahrenheitToLevel(f: number): number;
    static celsiusToLevel(c: number): number;
    static levelToCelsius(level: number): number;
}
