export type Backend = 'qnn' | 'gpu' | 'cpu';

export type DeviceProfile = {
  name: string;
  s25: boolean;
  ramGb: number;
  backend: Backend;
  width: number;
  height: number;
  steps: number;
  warning?: string;
};

const S25 = ['SM-S938U', 'SM-S938B', 'SM-S938W', 'SM-S938N', 'SM-S9380', 'SM-S938'];

/** SD 1.5 class, CreativeML OpenRAIL-M. Not bundled. About 2 GB as a single checkpoint. */
export const OFFLINE_MODEL = {
  name: 'SD 1.5 anime (OpenRAIL-M)',
  sizeMb: 2100,
  note: 'A phone cannot run Animagine XL. Offline mode is an SD 1.5 anime checkpoint you download into app storage. Qualcomm QNN is preferred on the Galaxy S25 Ultra when the Hexagon runtime is already on the phone. This build does not ship Qualcomm’s QNN SDK.',
};

export function profileFor(input: { model?: string | null; ramGb?: number | null; qnnPresent?: boolean; gpuPresent?: boolean }): DeviceProfile {
  const model = input.model ?? '';
  const s25 = S25.some((id) => model.toUpperCase().includes(id));
  const ram = input.ramGb ?? (s25 ? 12 : 0);
  const backend: Backend = input.qnnPresent ? 'qnn' : s25 && input.gpuPresent !== false ? 'gpu' : input.gpuPresent ? 'gpu' : 'cpu';
  if (s25) {
    return {
      name: 'Galaxy S25 Ultra',
      s25: true,
      ramGb: ram || 12,
      backend: input.qnnPresent ? 'qnn' : 'gpu',
      width: 512,
      height: 768,
      steps: 8,
      warning: input.qnnPresent
        ? undefined
        : 'Hexagon NPU runtime was not found. This phone will use the Adreno GPU. 512×768 at 8 steps is the fast default.',
    };
  }
  if (ram && ram < 6) {
    return {
      name: model || 'This phone',
      s25: false,
      ramGb: ram,
      backend: 'cpu',
      width: 512,
      height: 512,
      steps: 6,
      warning: 'This phone has under 6 GB of RAM. Offline images stay at 512×512 and few steps, and may be very slow.',
    };
  }
  return {
    name: model || 'This phone',
    s25: false,
    ramGb: ram,
    backend,
    width: 512,
    height: 512,
    steps: 12,
    warning: backend === 'cpu' ? 'No NPU or GPU runtime was found. CPU fallback is slow.' : undefined,
  };
}

export function offlineBlockedReason(input: { modelReady: boolean; runtime: 'missing' | 'qnn' | 'cpu' }): string | null {
  if (!input.modelReady) return 'Download the offline model first. It is not inside the APK.';
  if (input.runtime === 'missing') {
    return 'On-device Stable Diffusion is not running in this build. Qualcomm’s QNN libraries cannot be redistributed here, and there is no Hexagon NPU on this computer. The app will not pretend a painted preview is a diffusion result.';
  }
  return null;
}
