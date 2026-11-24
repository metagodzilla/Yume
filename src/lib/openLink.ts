import * as WebBrowser from 'expo-web-browser';

export function openLink(url: string) {
  void WebBrowser.openBrowserAsync(url).catch(() => undefined);
}
