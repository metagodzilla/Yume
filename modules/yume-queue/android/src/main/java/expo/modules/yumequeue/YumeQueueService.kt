package expo.modules.yumequeue

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

object YumeQueueBridge {
  var onAction: ((String) -> Unit)? = null
}

class YumeQueueService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action
    if (action == ACTION_PAUSE || action == ACTION_RESUME || action == ACTION_CANCEL) {
      YumeQueueBridge.onAction?.invoke(action)
      return START_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Yume"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: "Working"
    val progress = intent?.getIntExtra(EXTRA_PROGRESS, 0) ?: 0
    val count = intent?.getIntExtra(EXTRA_COUNT, 0) ?: 0
    startForeground(NOTIFICATION_ID, build(this, title, body, progress, count))
    return START_STICKY
  }

  companion object {
    private const val CHANNEL = "yume-queue"
    private const val NOTIFICATION_ID = 42
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_PROGRESS = "progress"
    private const val EXTRA_COUNT = "count"
    const val ACTION_PAUSE = "yume.PAUSE"
    const val ACTION_RESUME = "yume.RESUME"
    const val ACTION_CANCEL = "yume.CANCEL"

    fun start(context: Context, title: String, body: String, progress: Int, count: Int) {
      val intent = Intent(context, YumeQueueService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
        .putExtra(EXTRA_PROGRESS, progress)
        .putExtra(EXTRA_COUNT, count)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, YumeQueueService::class.java))
    }

    private fun build(context: Context, title: String, body: String, progress: Int, count: Int): android.app.Notification {
      if (Build.VERSION.SDK_INT >= 26) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Yume queue", NotificationManager.IMPORTANCE_LOW))
      }
      return NotificationCompat.Builder(context, CHANNEL)
        .setContentTitle(title)
        .setContentText("$body · $count in the queue")
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setOngoing(true)
        .setProgress(100, progress, progress == 0)
        .addAction(0, "Pause", pending(context, ACTION_PAUSE))
        .addAction(0, "Resume", pending(context, ACTION_RESUME))
        .addAction(0, "Cancel", pending(context, ACTION_CANCEL))
        .build()
    }

    private fun pending(context: Context, action: String): PendingIntent {
      val intent = Intent(context, YumeQueueService::class.java).setAction(action)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
      return PendingIntent.getService(context, action.hashCode(), intent, flags)
    }
  }
}
