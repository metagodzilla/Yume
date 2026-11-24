import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { fetchInstalls } from '@/src/lib/downloadClient';
import { downloadSummary, downloadTitle } from '@/src/lib/downloads';

export const DOWNLOAD_TASK = 'yume-download-poll';
export const DOWNLOAD_ENDPOINT_KEY = 'yume.download.endpoint';
const SALAD_KEY = 'yume.salad.apiKey';
const NOTIFICATION_ID = 'yume-download-progress';

TaskManager.defineTask(DOWNLOAD_TASK, async () => {
  try {
    const lines = await activeDownloadLines();
    if (!lines.length) {
      await dismissDownloadNotification();
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }
    await showDownloadNotification(lines);
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function rememberDownloadTarget(endpoint: string): Promise<void> {
  if (!endpoint) return;
  await AsyncStorage.setItem(DOWNLOAD_ENDPOINT_KEY, endpoint);
}

export async function ensureDownloadBackground(): Promise<boolean> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted || status === BackgroundFetch.BackgroundFetchStatus.Denied) return false;
    const registered = await TaskManager.isTaskRegisteredAsync(DOWNLOAD_TASK);
    if (!registered) {
      await BackgroundFetch.registerTaskAsync(DOWNLOAD_TASK, {
        minimumInterval: 60,
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
    return true;
  } catch {
    return false;
  }
}

async function activeDownloadLines(): Promise<string[]> {
  const endpoint = await AsyncStorage.getItem(DOWNLOAD_ENDPOINT_KEY);
  const key = await SecureStore.getItemAsync(SALAD_KEY);
  if (!endpoint || !key) return [];
  const jobs = await fetchInstalls(endpoint, key);
  return jobs
    .filter((job) => job.state === 'queued' || job.state === 'downloading' || job.state === 'paused')
    .map((job) => `${downloadTitle(job)} · ${downloadSummary(job)}`);
}

async function showDownloadNotification(lines: string[]): Promise<void> {
  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('downloads', {
      name: 'Downloads',
      importance: Notifications.AndroidImportance.LOW,
    });
  }
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title: 'Yume downloads',
      body: lines.slice(0, 4).join('\n'),
      sound: false,
    },
    trigger: null,
  });
}

async function dismissDownloadNotification(): Promise<void> {
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
    await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID);
  } catch {
    // The notification was already gone.
  }
}
