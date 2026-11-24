import { useEffect } from 'react';
import { AppState } from 'react-native';

import { readPhone } from '@/src/lib/device';
import { shouldKeepScreenAwake } from '@/src/lib/phonePower';
import { applyThermal } from '@/src/lib/queuestore';
import { publishHeat } from '@/src/lib/thermalState';
import { useStudio } from '@/src/studio';

export function ThermalGuard() {
  const studio = useStudio();
  const lowPower = studio.settings.lowPower;

  useEffect(() => {
    let live = true;
    const tick = async () => {
      const reading = await readPhone();
      if (!live) return;
      const throttle = publishHeat({ tempC: reading.tempC, thermalStatus: reading.thermalStatus, lowPower });
      applyThermal(throttle.pauseQueue ? 'pause' : 'resume');
      if (shouldKeepScreenAwake(AppState.currentState || 'background')) {
        // Yume does not hold a screen wake lock. Backgrounding leaves the screen free to sleep.
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 20_000);
    const sub = AppState.addEventListener('change', () => void tick());
    return () => {
      live = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [lowPower]);

  return null;
}
