import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { Linking, Platform } from 'react-native';

import { installApk } from 'yume-device';

export async function installReleaseApk(url: string): Promise<void> {
  if (Platform.OS !== 'android') {
    await Linking.openURL(url);
    return;
  }
  const destination = new File(Paths.cache, 'yume-update.apk');
  const file = await File.downloadFileAsync(url, destination, { idempotent: true });
  const contentUri = await getContentUriAsync(file.uri);
  installApk(contentUri);
}
