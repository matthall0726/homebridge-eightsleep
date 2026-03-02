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

export class EightSleepAPI {
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private authUserId: string | null = null;
  private deviceId: string | null = null;

  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly log: Logger,
  ) {}

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
    this.authUserId = res.userId;
    this.tokenExpiry = Date.now() + (res.expires_in - 300) * 1000;

    this.log.info('Authenticated successfully. userId:', this.authUserId);
  }

  async discover(): Promise<DiscoveryResult> {
    await this.authenticate();

    // Get current user to find the device ID
    const raw = await this.request(`${CLIENT_URL}/users/me`, 'GET') as Record<string, unknown>;
    const user = (raw.user || raw) as Record<string, unknown>;
    const userId = (user.userId || user.id || this.authUserId) as string;

    let deviceId: string;
    const currentDevice = user.currentDevice as { id: string } | undefined;
    const devices = user.devices as string[] | undefined;

    if (currentDevice?.id) {
      deviceId = currentDevice.id;
    } else if (devices && devices.length > 0) {
      deviceId = devices[0];
    } else {
      throw new Error('No devices found on account. userId: ' + userId);
    }
    this.deviceId = deviceId;

    // Get device to find left/right user IDs
    const device = await this.request(
      `${CLIENT_URL}/devices/${deviceId}?filter=leftUserId,rightUserId`,
      'GET',
    ) as Record<string, unknown>;

    const result = (device.result || device) as Record<string, unknown>;
    const leftUserId = result.leftUserId as string | undefined;
    const rightUserId = result.rightUserId as string | undefined;

    const sides: BedSide[] = [];
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

  async getTemperature(userId: string): Promise<TemperatureStatus> {
    await this.authenticate();
    return await this.request(
      `${APP_URL}/users/${userId}/temperature`,
      'GET',
    ) as TemperatureStatus;
  }

  async setTemperature(userId: string, level: number): Promise<void> {
    await this.authenticate();
    const clamped = Math.max(-100, Math.min(100, Math.round(level)));
    await this.request(`${APP_URL}/users/${userId}/temperature`, 'PUT', {
      currentLevel: clamped,
    });
  }

  async turnOn(userId: string): Promise<void> {
    await this.authenticate();
    await this.request(`${APP_URL}/users/${userId}/temperature`, 'PUT', {
      currentState: { type: 'smart' },
    });
  }

  async turnOff(userId: string): Promise<void> {
    await this.authenticate();
    await this.request(`${APP_URL}/users/${userId}/temperature`, 'PUT', {
      currentState: { type: 'off' },
    });
  }

  // --- Utility ---

  static levelToCelsius(level: number): number {
    // -100 = 13°C, 0 = 27°C, 100 = 44°C
    if (level <= 0) {
      return 27 + (level / 100) * 14;
    }
    return 27 + (level / 100) * 17;
  }

  static celsiusToLevel(c: number): number {
    if (c <= 27) {
      return ((c - 27) / 14) * 100;
    }
    return ((c - 27) / 17) * 100;
  }
}
