"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EightSleepAPI = void 0;
const https_1 = __importDefault(require("https"));
const AUTH_URL = 'https://auth-api.8slp.net/v1';
const CLIENT_URL = 'https://client-api.8slp.net/v1';
const APP_URL = 'https://app-api.8slp.net/v1';
const CLIENT_ID = '0894c7f33bb94800a03f1f4df13a4f38';
const CLIENT_SECRET = 'f0954a3ed5763ba3d06834c73731a32f15f168f47d4f164751275def86db0c76';
class EightSleepAPI {
    constructor(email, password, log) {
        this.email = email;
        this.password = password;
        this.log = log;
        this.accessToken = null;
        this.tokenExpiry = 0;
        this.authUserId = null;
        this.deviceId = null;
    }
    request(url, method, body) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const payload = body ? JSON.stringify(body) : undefined;
            const options = {
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'okhttp/4.9.3',
                    ...(this.accessToken ? { 'Authorization': `Bearer ${this.accessToken}` } : {}),
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            };
            const req = https_1.default.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(data ? JSON.parse(data) : {});
                        }
                        catch {
                            resolve(data);
                        }
                    }
                    else if (res.statusCode === 429) {
                        reject(new Error('Rate limited by Eight Sleep API. Try again later.'));
                    }
                    else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            if (payload) {
                req.write(payload);
            }
            req.end();
        });
    }
    async authenticate() {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return;
        }
        this.log.info('Authenticating with Eight Sleep...');
        const res = await this.request(`${AUTH_URL}/tokens`, 'POST', {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'password',
            username: this.email,
            password: this.password,
        });
        this.accessToken = res.access_token;
        this.authUserId = res.userId;
        this.tokenExpiry = Date.now() + (res.expires_in - 300) * 1000;
        this.log.info('Authenticated successfully. userId:', this.authUserId);
    }
    async discover() {
        await this.authenticate();
        // Get current user to find the device ID
        const raw = await this.request(`${CLIENT_URL}/users/me`, 'GET');
        const user = (raw.user || raw);
        const userId = (user.userId || user.id || this.authUserId);
        let deviceId;
        const currentDevice = user.currentDevice;
        const devices = user.devices;
        if (currentDevice?.id) {
            deviceId = currentDevice.id;
        }
        else if (devices && devices.length > 0) {
            deviceId = devices[0];
        }
        else {
            throw new Error('No devices found on account. userId: ' + userId);
        }
        this.deviceId = deviceId;
        // Get device to find left/right user IDs
        const device = await this.request(`${CLIENT_URL}/devices/${deviceId}?filter=leftUserId,rightUserId`, 'GET');
        const result = (device.result || device);
        const leftUserId = result.leftUserId;
        const rightUserId = result.rightUserId;
        const sides = [];
        if (leftUserId) {
            sides.push({ userId: leftUserId, side: 'left' });
        }
        if (rightUserId) {
            sides.push({ userId: rightUserId, side: 'right' });
        }
        // Fallback: if no sides found, use the authenticated user
        if (sides.length === 0) {
            this.log.warn('Could not determine bed sides, using authenticated user as left side');
            sides.push({ userId, side: 'left' });
        }
        this.log.info(`Discovered device: ${deviceId}, sides: ${sides.map(s => `${s.side}(${s.userId})`).join(', ')}`);
        return { deviceId, sides };
    }
    // --- Temperature per user ---
    async getTemperature(userId) {
        await this.authenticate();
        return await this.request(`${APP_URL}/users/${userId}/temperature`, 'GET');
    }
    async setTemperature(userId, level) {
        await this.authenticate();
        const clamped = Math.max(-100, Math.min(100, Math.round(level)));
        await this.request(`${APP_URL}/users/${userId}/temperature`, 'PUT', {
            currentLevel: clamped,
        });
    }
    async turnOn(userId) {
        await this.authenticate();
        await this.request(`${APP_URL}/users/${userId}/temperature`, 'PUT', {
            currentState: { type: 'smart' },
        });
    }
    async turnOff(userId) {
        await this.authenticate();
        await this.request(`${APP_URL}/users/${userId}/temperature`, 'PUT', {
            currentState: { type: 'off' },
        });
    }
    // --- Utility ---
    static levelToCelsius(level) {
        // -100 = 13°C, 0 = 27°C, 100 = 44°C
        if (level <= 0) {
            return 27 + (level / 100) * 14;
        }
        return 27 + (level / 100) * 17;
    }
    static celsiusToLevel(c) {
        if (c <= 27) {
            return ((c - 27) / 14) * 100;
        }
        return ((c - 27) / 17) * 100;
    }
}
exports.EightSleepAPI = EightSleepAPI;
