import * as Battery from 'expo-battery';

import { estimatePowerWatts } from '@/src/lib/phonePower';
import { readNativeDevice } from 'yume-device';

export type PhoneReading = {
  batteryPercent: number | null;
  charging: boolean | null;
  tempC: number | null;
  powerWatts: number | null;
  thermalStatus: number | null;
  appRssMb: number | null;
  appCpuPercent: number | null;
  source: 'android' | 'expo-battery' | 'none';
};

export async function readPhone(): Promise<PhoneReading> {
  const native = readNativeDevice();
  let batteryPercent = typeof native?.batteryPercent === 'number' ? native.batteryPercent : null;
  let charging: boolean | null = native?.available ? Boolean(native.charging) : null;
  let source: PhoneReading['source'] = native?.available ? 'android' : 'none';
  if (batteryPercent == null) {
    try {
      const level = await Battery.getBatteryLevelAsync();
      if (typeof level === 'number' && level >= 0) batteryPercent = Math.round(level * 100);
      const state = await Battery.getBatteryStateAsync();
      charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
      if (batteryPercent != null) source = native?.available ? 'android' : 'expo-battery';
    } catch {
      // Web and desktop previews have no battery API.
    }
  }
  return {
    batteryPercent,
    charging,
    tempC: typeof native?.tempC === 'number' ? native.tempC : null,
    powerWatts: estimatePowerWatts(native?.currentMicroA ?? null, native?.voltageMv ?? null),
    thermalStatus: typeof native?.thermalStatus === 'number' ? native.thermalStatus : null,
    appRssMb: typeof native?.appRssMb === 'number' ? native.appRssMb : null,
    appCpuPercent: typeof native?.appCpuPercent === 'number' ? native.appCpuPercent : null,
    source,
  };
}
