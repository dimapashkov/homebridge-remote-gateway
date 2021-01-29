"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GateServiceAccessory = void 0;
const bind_decorator_1 = __importDefault(require("bind-decorator"));
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
class GateServiceAccessory {
    constructor(platform, log, config, api, accessory) {
        this.platform = platform;
        this.log = log;
        this.config = config;
        this.api = api;
        this.accessory = accessory;
        this.gateOptions = accessory.context.device;
        // this.log.info(JSON.stringify(this.gateOptions));
        this.lastPosition = 0;
        this.currentState = 'closed';
        this.targetState = 'closed';
        this.obstructionDetected = false;
        this.gateService = this.accessory.getService(this.platform.Service.GarageDoorOpener) || this.accessory.addService(this.platform.Service.GarageDoorOpener);
        // set HomeKit accessory name
        this.gateService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);
        const Characteristic = this.api.hap.Characteristic;
        // create handlers for required characteristics
        this.gateService.getCharacteristic(Characteristic.CurrentDoorState)
            .on('get', this.handleCurrentDoorStateGet.bind(this));
        this.gateService.getCharacteristic(Characteristic.TargetDoorState)
            .on('get', this.handleTargetDoorStateGet.bind(this))
            .on('set', this.handleTargetDoorStateSet.bind(this));
        this.gateService.getCharacteristic(Characteristic.ObstructionDetected)
            .on('get', this.handleObstructionDetectedGet.bind(this));
        if (this.gateOptions.positionTopic) {
            this.platform.mqttSubscribe(this.gateOptions.positionTopic, msg => {
                this.handleGatePosition(msg);
            });
        }
        if (this.gateOptions.key) {
            this.platform.mqttSubscribe(this.gateOptions.key, msg => {
                this.sendGateSwitchSignal();
            });
        }
    }
    handleGatePosition(message) {
        const currentPosition = parseInt(message.toString(), 10);
        if (this.stateTimeout)
            clearTimeout(this.stateTimeout);
        if (currentPosition < this.lastPosition) {
            // opening
            this.handleGateState('opening');
        }
        else {
            if (this.currentState === 'opening') {
                this.obstructionDetected = true;
                setTimeout(() => {
                    this.obstructionDetected = false;
                }, 3000);
            }
            // closing
            this.handleGateState('closing');
        }
        this.log.info(`${this.lastPosition} -> ${currentPosition} = ${this.currentState}`);
        this.stateTimeout = setTimeout(() => {
            this.log.info(`stateTimeout ${this.lastPosition} -> ${currentPosition}`);
            // change state to open
            if (this.currentState === 'opening') {
                this.handleGateState('open');
            }
            else {
                this.handleGateState('closed');
            }
            this.obstructionDetected = false;
        }, 2000);
        this.lastPosition = currentPosition;
    }
    handleGateState(state) {
        if (this.currentState !== state) {
            this.log.info('Handle Gate State', state);
            this.currentState = state;
        }
    }
    sendGateSwitchSignal() {
        this.log.info('Switch ' + this.gateOptions.displayName + ' State');
        if (this.gateOptions.switchTopic && this.gateOptions.switchMessage) {
            this.platform.mqttPublish(this.gateOptions.switchTopic, this.gateOptions.switchMessage);
        }
    }
    /**
     * Handle requests to get the current value of the "Current Door State" characteristic
     */
    handleCurrentDoorStateGet(callback) {
        // this.log.info('Triggered GET Current Gate State', this.currentState);
        switch (this.currentState) {
            case 'open': // OPEN	Characteristic.CurrentDoorState.OPEN	0
                this.targetState = 'open';
                callback(null, 0);
                break;
            case 'closed': // CLOSED	Characteristic.CurrentDoorState.CLOSED	1
                this.targetState = 'closed';
                callback(null, 1);
                break;
            case 'opening': // OPENING	Characteristic.CurrentDoorState.OPENING	2
                this.targetState = 'open';
                callback(null, 2);
                break;
            case 'closing': // CLOSING	Characteristic.CurrentDoorState.CLOSING	3
                this.targetState = 'closed';
                callback(null, 3);
                break;
        }
    }
    /**
     * Handle requests to get the current value of the "Target Door State" characteristic
     */
    handleTargetDoorStateGet(callback) {
        // this.log.info('Triggered GET TargetDoorState');
        // OPEN	Characteristic.TargetDoorState.OPEN	0
        // CLOSED	Characteristic.TargetDoorState.CLOSED	1
        this.log.info('Triggered GET Target Gate State:', this.targetState);
        callback(null, this.targetState === 'open' ? 0 : 1);
    }
    /**
     * Handle requests to set the "Target Door State" characteristic
     */
    handleTargetDoorStateSet(value, callback) {
        // OPEN	Characteristic.TargetDoorState.OPEN	0
        // CLOSED	Characteristic.TargetDoorState.CLOSED	1
        // this.sendGateSwitchSignal();
        const targetState = (value === 0) ? 'open' : 'closed';
        this.log.info('Triggered SET Target Gate State:', targetState);
        if (targetState !== this.targetState) {
            this.targetState = targetState;
            if (this.targetState === 'closed') {
                if (this.currentState === 'open') {
                    // 1 time switch
                    this.sendGateSwitchSignal();
                }
                else if (this.currentState === 'opening') {
                    // 2 time switch
                    this.sendGateSwitchSignal();
                    setTimeout(() => this.sendGateSwitchSignal(), 1500);
                }
            }
            else { // targetState === 'open'
                if (this.currentState === 'closed') {
                    // 1 time switch
                    this.sendGateSwitchSignal();
                }
                else if (this.currentState === 'closing') {
                    // 2 time switch
                    this.sendGateSwitchSignal();
                    setTimeout(() => this.sendGateSwitchSignal(), 1500);
                }
            }
        }
        callback(null);
    }
    /**
     * Handle requests to get the current value of the "Obstruction Detected" characteristic
     */
    handleObstructionDetectedGet(callback) {
        // this.log.info('Triggered GET ObstructionDetected');
        callback(null, this.obstructionDetected);
    }
}
__decorate([
    bind_decorator_1.default
], GateServiceAccessory.prototype, "handleGatePosition", null);
exports.GateServiceAccessory = GateServiceAccessory;
//# sourceMappingURL=GateServiceAccessory.js.map