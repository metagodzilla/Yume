import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { Linking, Platform } from 'react-native';

import { describeUpdateError, type DownloadBytes } from '@/src/lib/apkInstall';
import { installApk } from 'yume-device';

export async function installReleaseApk(url: string, onProgress?: (progress: DownloadBytes) => void): Promise<void> {
  if (Platform.OS !== 'android') {
    await Linking.openURL(url);
    return;
  }
  const destination = new File(Paths.cache, 'yume-update.apk');
  let file: File;
  try {
    file = await File.downloadFileAsync(url, destination, {
      idempotent: true,
      onProgress: (progress) => onProgress?.(progress),
    });
  } catch (error) {
    throw new Error(describeUpdateError(error));
  }
  const shared = file.contentUri?.startsWith('content:') ? file.contentUri : await getContentUriAsync(file.uri);
  if (!shared.startsWith('content:')) {
    throw new Error('The downloaded APK could not be shared with the Android installer.');
  }
  try {
    installApk(shared, file.uri);
  } catch (error) {
    throw new Error(describeUpdateError(error));
  }
}
