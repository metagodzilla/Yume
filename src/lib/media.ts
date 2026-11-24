import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { Platform } from 'react-native';

function downloadInBrowser(uri: string, filename: string) {
  if (typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = uri;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function saveImageToLibrary(uri: string, filename: string): Promise<string> {
  if (Platform.OS === 'web') {
    downloadInBrowser(uri, filename);
    return 'Downloaded in this browser. On a phone, this saves into your photo library.';
  }
  const permission = await requestPermissionsAsync(true);
  if (!permission.granted) {
    throw new Error('Photo access is off. Allow Yume to add photos, then try saving again.');
  }
  await Asset.create(uri);
  return 'Saved to your photo library.';
}

export async function shareFile(uri: string, filename: string, mime: string): Promise<string> {
  if (Platform.OS === 'web') {
    downloadInBrowser(uri, filename);
    return 'Downloaded in this browser.';
  }
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: filename });
  return 'Share sheet opened.';
}

export async function shareImage(uri: string, filename: string): Promise<string> {
  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        const blob = await (await fetch(uri)).blob();
        const file = new File([blob], filename, { type: 'image/png' });
        if (!nav.canShare || nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: 'Yume' });
          return 'Share sheet opened.';
        }
      } catch {
        // Fall through to a download if the browser share sheet refuses the file.
      }
    }
    downloadInBrowser(uri, filename);
    return 'Downloaded. Your browser could not open a share sheet.';
  }
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: 'Share your frame',
  });
  return 'Share sheet opened.';
}

export async function copyText(value: string): Promise<void> {
  await Clipboard.setStringAsync(value);
}
