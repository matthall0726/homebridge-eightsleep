import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { EightSleepAPI, BedSide } from './EightSleepAPI';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

interface SideState {
  userId: string;
  side: 'left' | 'right';
  currentLevel: number;
  isOn: boolean;
}

export class EightSleepPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly api: EightSleepAPI;
  private readonly accessories: PlatformAccessory[] = [];
  private readonly sideStates: Map<string, SideState> = new Map();
  private readonly pollingInterval: number;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly homebridgeApi: API,
  ) {
    this.Service = this.homebridgeApi.hap.Service;
    this.Characteristic = this.homebridgeApi.hap.Characteristic;

    const cfg = config as PlatformConfig & { email: string; password: string; pollingInterval?: number };
    this.pollingInterval = (cfg.pollingInterval || 60) * 1000;
    this.api = new EightSleepAPI(cfg.email, cfg.password, this.log);

    this.homebridgeApi.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  private async discoverDevices(): Promise<void> {
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
        } else {
          this.log.info('Adding accessory:', displayName);
          const accessory = new this.homebridgeApi.platformAccessory(displayName, uuid);
          accessory.context.deviceId = discovery.deviceId;
          accessory.context.userId = bedSide.userId;
          accessory.context.side = bedSide.side;
          this.setupThermostat(accessory, uuid);
          this.homebridgeApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.accessories.push(accessory);
        }
      }

      // Remove stale accessories for sides that no longer exist
      const validUUIDs = discovery.sides.map(s =>
        this.homebridgeApi.hap.uuid.generate(`eightsleep-${discovery.deviceId}-${s.side}`),
      );
      const stale = this.accessories.filter(a => !validUUIDs.includes(a.UUID));
      if (stale.length > 0) {
        this.homebridgeApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      }

      this.startPolling();
    } catch (err) {
      this.log.error('Failed to discover Eight Sleep devices:', (err as Error).message);
    }
  }

  private setupThermostat(accessory: PlatformAccessory, uuid: string): void {
    const state = this.sideStates.get(uuid)!;

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
          } else {
            await this.api.turnOn(state.userId);
            state.isOn = true;
          }
        } catch (err) {
          this.log.error(`Failed to set power (${state.side}):`, (err as Error).message);
        }
      });

    thermostat.getCharacteristic(this.Characteristic.CurrentTemperature)
      .setProps({ minValue: 13, maxValue: 44, minStep: 0.5 })
      .onGet(() => EightSleepAPI.levelToCelsius(state.currentLevel));

    thermostat.getCharacteristic(this.Characteristic.TargetTemperature)
      .setProps({ minValue: 13, maxValue: 44, minStep: 0.5 })
      .onGet(() => EightSleepAPI.levelToCelsius(state.currentLevel))
      .onSet(async (value) => {
        try {
          const level = EightSleepAPI.celsiusToLevel(value as number);
          await this.api.setTemperature(state.userId, level);
          state.currentLevel = level;
        } catch (err) {
          this.log.error(`Failed to set temperature (${state.side}):`, (err as Error).message);
        }
      });

    thermostat.getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
      .onGet(() => this.Characteristic.TemperatureDisplayUnits.CELSIUS)
      .onSet(() => {});
  }

  private startPolling(): void {
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
            thermostat.updateCharacteristic(
              this.Characteristic.CurrentTemperature,
              EightSleepAPI.levelToCelsius(state.currentLevel),
            );
            thermostat.updateCharacteristic(
              this.Characteristic.CurrentHeatingCoolingState,
              !state.isOn
                ? this.Characteristic.CurrentHeatingCoolingState.OFF
                : state.currentLevel < 0
                  ? this.Characteristic.CurrentHeatingCoolingState.COOL
                  : this.Characteristic.CurrentHeatingCoolingState.HEAT,
            );
          }
        } catch (err) {
          this.log.error(`Polling error (${state.side}):`, (err as Error).message);
        }
      }
    }, this.pollingInterval);
  }
}
