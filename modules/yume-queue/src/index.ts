import { requireNativeModule } from 'expo';

type YumeQueueNative = {
  update(title: string, body: string, progress: number, count: number): void;
  stop(): void;
  addListener(event: 'action', listener: (event: { type: string }) => void): { remove(): void };
};

export function publishQueue(title: string, body: string, progress: number, count: number) {
  try {
    const native = requireNativeModule<YumeQueueNative>('YumeQueue');
    if (count <= 0) native.stop();
    else native.update(title, body, progress, count);
  } catch {
    // Web and iOS have no foreground service. The queue still persists on device.
  }
}
