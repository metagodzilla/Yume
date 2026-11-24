import { requireNativeModule } from 'expo';

export type NativeDevice = {
  available?: boolean;
  batteryPercent?: number | null;
  charging?: boolean;
  tempC?: number | null;
  currentMicroA?: number | null;
  voltageMv?: number | null;
  thermalStatus?: number | null;
  appRssMb?: number | null;
  appCpuPercent?: number | null;
};

export function readNativeDevice(): NativeDevice | null {
  try {
    const native = requireNativeModule<{ read(): NativeDevice }>('YumeDevice');
    return native.read();
  } catch {
    return null;
  }
}

export function installApk(contentUri: string) {
  const native = requireNativeModule<{ installApk(contentUri: string): void }>('YumeDevice');
  native.installApk(contentUri);
}
