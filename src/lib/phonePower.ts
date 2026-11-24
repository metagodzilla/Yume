export type Heat = 'cool' | 'warm' | 'hot';

export type Throttle = {
  heat: Heat;
  stepFactor: number;
  maxCount: number;
  pauseMs: number;
  pauseQueue: boolean;
  preferCloud: boolean;
  refreshMs: number;
  notice: string | null;
};

export function estimatePowerWatts(currentMicroA: number | null, voltageMv: number | null): number | null {
  if (currentMicroA == null || voltageMv == null) return null;
  if (!Number.isFinite(currentMicroA) || !Number.isFinite(voltageMv)) return null;
  const amps = Math.abs(currentMicroA) / 1_000_000;
  const volts = voltageMv / 1000;
  if (amps <= 0 || volts <= 0) return null;
  return amps * volts;
}

export function classifyHeat(input: { tempC: number | null; thermalStatus: number | null; lowPower: boolean }): Heat {
  const temp = input.tempC;
  const status = input.thermalStatus;
  if ((temp != null && temp >= 42) || (status != null && status >= 3)) return 'hot';
  if (input.lowPower || (temp != null && temp >= 38) || (status != null && status >= 1)) return 'warm';
  return 'cool';
}

export function throttleFor(heat: Heat): Throttle {
  if (heat === 'hot') {
    return {
      heat,
      stepFactor: 0.5,
      maxCount: 1,
      pauseMs: 0,
      pauseQueue: true,
      preferCloud: true,
      refreshMs: 15_000,
      notice: 'Phone is hot. The queue is paused and new phone draws wait until it cools. Cloud is used when it is available.',
    };
  }
  if (heat === 'warm') {
    return {
      heat,
      stepFactor: 0.6,
      maxCount: 1,
      pauseMs: 4_000,
      pauseQueue: false,
      preferCloud: true,
      refreshMs: 8_000,
      notice: 'Phone is warm. Offline draws use fewer steps, one image at a time, and a pause between images.',
    };
  }
  return {
    heat,
    stepFactor: 1,
    maxCount: 4,
    pauseMs: 0,
    pauseQueue: false,
    preferCloud: false,
    refreshMs: 5_000,
    notice: null,
  };
}

export function throttleSteps(steps: number, count: number, throttle: Throttle): { steps: number; count: number } {
  return {
    steps: Math.max(1, Math.round(steps * throttle.stepFactor)),
    count: Math.max(1, Math.min(count, throttle.maxCount)),
  };
}

export function shouldKeepScreenAwake(appState: string): boolean {
  return appState === 'active' ? false : false;
}

export function thermalStatusName(status: number | null): string {
  if (status == null) return 'n/a';
  return ['none', 'light', 'moderate', 'severe', 'critical', 'emergency', 'shutdown'][status] ?? 'n/a';
}
