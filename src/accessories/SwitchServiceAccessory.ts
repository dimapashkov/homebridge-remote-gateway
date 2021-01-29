import {
  Service,
  PlatformAccessory,
  API, Logger, PlatformConfig
} from 'homebridge';
import { RemoteGatewayConfig, RemoteGatewayHomebridgePlatform } from '../platform';
import { DeviceSchema } from '../device.schema';

export interface SwitchServiceAccessoryInterface extends DeviceSchema {
  switchTopic?: string;
  switchMessage?: string;
}

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SwitchServiceAccessory {
  private switchService: Service;
  private name: string;
  private switchOptions: SwitchServiceAccessoryInterface;

  constructor(
    private readonly platform: RemoteGatewayHomebridgePlatform,
    private readonly log: Logger,
    private readonly config: RemoteGatewayConfig,
    private readonly api: API,
    private readonly accessory: PlatformAccessory
  ) {
    this.switchOptions = accessory.context.device;

    const Characteristic = this.platform.Characteristic;

    // extract name from config
    this.name = this.config.displayName;

    // create a new Stateless Programmable Switch service
    this.switchService = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

    // create handlers for required characteristics
    this.switchService.getCharacteristic(Characteristic.On)
      .on('get', this.handleOnGet.bind(this))
      .on('set', this.handleOnSet.bind(this));

    if(this.switchOptions.key){
      this.platform.mqttSubscribe(this.switchOptions.key, msg => {
        this.sendSwitchSignal();
      });
    }
  }

  sendSwitchSignal(){
    this.log.info('Switch '+this.switchOptions.displayName+' State');
    if(this.switchOptions.switchTopic && this.switchOptions.switchMessage){
      this.platform.mqttPublish(this.switchOptions.switchTopic, this.switchOptions.switchMessage);
    }
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  handleOnGet(callback) {
    this.log.debug('Triggered GET On');
    // set this to a valid value for On
    const currentValue = 1;
    callback(null, currentValue);
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  handleOnSet(value, callback) {
    this.log.debug('Triggered SET On:', value);
    this.sendSwitchSignal();
    callback(null);
  }
}
