export interface DeviceSchema {
  type: 'gate' | 'switch';
  displayName: string;
  key: string; // unique key - md5 hash
}
