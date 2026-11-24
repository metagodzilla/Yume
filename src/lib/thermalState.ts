import { classifyHeat, throttleFor, type Throttle } from '@/src/lib/phonePower';

let throttle: Throttle = throttleFor('cool');

export function getThrottle(): Throttle {
  return throttle;
}

export function publishHeat(input: { tempC: number | null; thermalStatus: number | null; lowPower: boolean }): Throttle {
  throttle = throttleFor(classifyHeat(input));
  return throttle;
}
