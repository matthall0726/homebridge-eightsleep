import https from 'https';
import { Logger } from 'homebridge';

const AUTH_URL = 'https://auth-api.8slp.net/v1';
const CLIENT_URL = 'https://client-api.8slp.net/v1';
const APP_URL = 'https://app-api.8slp.net/v1';

const CLIENT_ID = '0894c7f33bb94800a03f1f4df13a4f38';
const CLIENT_SECRET = 'f0954a3ed5763ba3d06834c73731a32f15f168f47d4f164751275def86db0c76';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  userId: string;
}

interface UserInfo {
  userId: string;
  currentDevice: {
    id: string;
    side: string;
  };
  features: string[];
}

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

export class EightSleepAPI {
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private userId: string | null = null;
  private deviceId: string | null = null;
  private side: string | null = null;

  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly log: Logger,
  ) {}

  // --- HTTP helper ---

  private request(url: string, method: string, body?: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const payload = body ? JSON.stringify(body) : undefined;

      const options: https.RequestOptions = {
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

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: string) => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch {
              resolve(data);
            }
          } else if (res.statusCode === 429) {
            reject(new Error('Rate limited by Eight Sleep API. Try again later.'));
          } else {
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

  // --- Auth ---

  async authenticate(): Promise<void> {
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
    }) as TokenResponse;

    this.accessToken = res.access_token;
    this.userId = res.userId;
    // Refresh 5 minutes before expiry
    this.tokenExpiry = Date.now() + (res.expires_in - 300) * 1000;

    this.log.info('Authenticated successfully. userId:', this.userId);
  }

  // --- Discovery ---

  async discover(): Promise<{ userId: string; deviceId: string; side: string; features: string[] }> {
    await this.authenticate();

    const user = await this.request(`${CLIENT_URL}/users/me`, 'GET') as UserInfo;

    this.userId = user.userId;
    this.deviceId = user.currentDevice.id;
    this.side = user.currentDevice.side;

    this.log.info(`Discovered device: ${this.deviceId}, side: ${this.side}`);
    return {
      userId: user.userId,
      deviceId: user.currentDevice.id,
      side: user.currentDevice.side,
      features: user.features || [],
    };
  }

  getUserId(): string {
    if (!this.userId) {
      throw new Error('Not authenticated. Call discover() first.');
    }
    return this.userId;
  }

  getDeviceId(): string {
    if (!this.deviceId) {
      throw new Error('Not discovered. Call discover() first.');
    }
    return this.deviceId;
  }

  // --- Power / State ---

  async turnOn(): Promise<void> {
    await this.authenticate();
    await this.request(`${APP_URL}/users/${this.userId}/temperature`, 'PUT', {
      currentState: { type: 'smart' },
    });
  }

  async turnOff(): Promise<void> {
    await this.authenticate();
    await this.request(`${APP_URL}/users/${this.userId}/temperature`, 'PUT', {
      currentState: { type: 'off' },
    });
  }

  // --- Temperature ---

  async getTemperature(): Promise<TemperatureStatus> {
    await this.authenticate();
    return await this.request(
      `${APP_URL}/users/${this.userId}/temperature`,
      'GET',
    ) as TemperatureStatus;
  }

  async setTemperature(level: number): Promise<void> {
    await this.authenticate();
    const clamped = Math.max(-100, Math.min(100, Math.round(level)));
    await this.request(`${APP_URL}/users/${this.userId}/temperature`, 'PUT', {
      currentLevel: clamped,
    });
  }

  // --- Presence ---

  async getPresence(): Promise<boolean> {
    await this.authenticate();
    const res = await this.request(
      `${CLIENT_URL}/users/${this.userId}/presence`,
      'GET',
    ) as { presence: boolean };
    return res.presence;
  }

  // --- Device Info ---

  async getDeviceSides(): Promise<DeviceStatus> {
    await this.authenticate();
    return await this.request(
      `${CLIENT_URL}/devices/${this.deviceId}?filter=leftUserId,rightUserId`,
      'GET',
    ) as DeviceStatus;
  }

  // --- Nap Mode ---

  async activateNapMode(): Promise<void> {
    await this.authenticate();
    await this.request(
      `${CLIENT_URL}/users/${this.userId}/temperature/nap-mode/activate`,
      'POST',
      {},
    );
  }

  async deactivateNapMode(): Promise<void> {
    await this.authenticate();
    await this.request(
      `${CLIENT_URL}/users/${this.userId}/temperature/nap-mode/deactivate`,
      'POST',
      {},
    );
  }

  // --- Away Mode ---

  async setAwayMode(away: boolean): Promise<void> {
    await this.authenticate();
    const now = new Date();
    // Set 24 hours in the past to trigger immediately
    now.setHours(now.getHours() - 24);
    const timestamp = now.toISOString();

    const body = away
      ? { awayPeriod: { start: timestamp } }
      : { awayPeriod: { end: timestamp } };

    await this.request(`${APP_URL}/users/${this.userId}/away-mode`, 'PUT', body);
  }

  // --- Utility ---

  static levelToFahrenheit(level: number): number {
    // Approximate linear mapping: -100 = 55°F, 0 = 80°F, 100 = 111°F
    if (level <= 0) {
      return 80 + (level / 100) * 25; // 55 to 80
    }
    return 80 + (level / 100) * 31; // 80 to 111
  }

  static fahrenheitToLevel(f: number): number {
    if (f <= 80) {
      return ((f - 80) / 25) * 100; // 55°F → -100, 80°F → 0
    }
    return ((f - 80) / 31) * 100; // 80°F → 0, 111°F → 100
  }

  static celsiusToLevel(c: number): number {
    const f = (c * 9) / 5 + 32;
    return EightSleepAPI.fahrenheitToLevel(f);
  }

  static levelToCelsius(level: number): number {
    const f = EightSleepAPI.levelToFahrenheit(level);
    return ((f - 32) * 5) / 9;
  }
}
