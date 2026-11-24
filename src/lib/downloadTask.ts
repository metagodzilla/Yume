import AsyncStorage from '@react-native-async-storage/async-storage';

export const DOWNLOAD_TASK = 'yume-download-poll';
export const DOWNLOAD_ENDPOINT_KEY = 'yume.download.endpoint';

export async function rememberDownloadTarget(endpoint: string): Promise<void> {
  if (!endpoint) return;
  await AsyncStorage.setItem(DOWNLOAD_ENDPOINT_KEY, endpoint);
}

export async function ensureDownloadBackground(): Promise<boolean> {
  return false;
}
