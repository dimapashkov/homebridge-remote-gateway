import WebSocket from 'ws';
import net from 'net';
import aedes from 'aedes';
import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { DeviceSchema } from './device.schema';
import { GateServiceAccessory } from './accessories/GateServiceAccessory';
import { SwitchServiceAccessory } from './accessories/SwitchServiceAccessory';

export interface RemoteGatewayConfig extends PlatformConfig {
  wsReconnectInterval?: number;
  wsConnectionURL?: string;
  mqttPort?: number;
  devices?: DeviceSchema[];
}

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class RemoteGatewayHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  private mqtt: aedes.Aedes;
  private ws: WebSocket | undefined;
  private readonly wsConnectionURL: string | null;
  private readonly wsReconnectInterval: number;
  private mqttServer: net.Server;

  constructor(
    public readonly log: Logger,
    public readonly config: RemoteGatewayConfig,
    public readonly api: API
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    // MQTT
    this.mqtt = aedes();
    this.mqttServer = net.createServer(this.mqtt.handle);
    this.mqttConnect();

    // WS
    this.wsConnectionURL = this.config.wsConnectionURL || null;
    this.wsReconnectInterval = 1000 * (this.config.wsReconnectInterval || 10);
    this.wsConnect();


    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  mqttConnect(){
    // MQTT
    const mqttPort = this.config.mqttPort || 1883;
    this.mqttServer.listen(mqttPort,  () => {
      this.log.info('MQTT Server started and listening on port ', mqttPort);
    });
  }

  mqttSubscribe(topic: string, cb: (msg: string) => void){
    this.mqtt.subscribe(topic, (packet, done) => {
      cb(packet.payload.toString());
      done();
    }, () => {});
  }

  mqttPublish(topic: string, message: string){
    if(!this.mqtt.closed){
      this.mqtt.publish({
        cmd: 'publish',
        // messageId: 42,
        qos: 0,
        dup: false,
        topic,
        payload: Buffer.from(message),
        retain: false,
      }, err => {
        if(err) console.error(err);
      });
      return true;
    }
    return false;
  }

  wsConnect(){
    if(this.wsConnectionURL){
      this.ws = new WebSocket(this.wsConnectionURL);
      this.ws.on('open', () => {
        this.log.info('Socket connected');
      });
      this.ws.on('error', (err) => {
        this.log.error('Socket error: ' + err.message);
      });
      this.ws.on('close', () => {
        this.log.info('Socket disconnected');
        setTimeout(() => this.wsConnect(), this.wsReconnectInterval);
      });
      this.ws.on('message', (data) => {
        const payload = data.toString();
        this.log.debug('Socket message: ' + payload);
        try {
          const cmd = JSON.parse(data.toString());
          this.mqttPublish(cmd.action, payload);
        } catch (e) {
          this.log.error('Socket error: ' + e.message);
        }
      });
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    const devices: DeviceSchema[] = this.config.devices || [];
    const uuids = devices.map(d => this.api.hap.uuid.generate(d.key));

    // remove old other
    for (const accessory of this.accessories){
      if(uuids.indexOf(accessory.UUID) === -1){
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    // loop over the discovered devices and register each one if it has not already been registered
    let devIndex = 0;
    for (const device of devices) {
      devIndex++;
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.key);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        this.initAccessory(device, existingAccessory);

      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.displayName);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.displayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        this.initAccessory(device, accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
      // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  initAccessory(device: DeviceSchema, accessory: PlatformAccessory){
    switch (device.type) {
      case 'gate':
        new GateServiceAccessory(this, this.log, this.config, this.api, accessory);
        break;
      case 'switch':
        new SwitchServiceAccessory(this, this.log, this.config, this.api, accessory);
        break;
    }

  }
}
