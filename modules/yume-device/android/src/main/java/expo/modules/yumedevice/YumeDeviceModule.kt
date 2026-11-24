package expo.modules.yumedevice

import android.app.ActivityManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class YumeDeviceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("YumeDevice")
    Function("read") {
      readDevice(appContext.reactContext)
    }
    Function("installApk") { contentUri: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Yume is not attached to Android yet.")
      val uri = Uri.parse(contentUri)
      if (uri.scheme != "content") {
        throw IllegalArgumentException("The installer needs a content URI from Yume's file provider.")
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
        val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
          context.startActivity(settings)
        } catch (_: ActivityNotFoundException) {
          throw IllegalStateException("Android did not open the install-permission screen for Yume. Open Settings, Apps, Yume, and allow install unknown apps.")
        }
        throw IllegalStateException("Android is asking Yume for permission to install apps. Turn on Allow from this source, then tap Update again.")
      }
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        clipData = ClipData.newRawUri("yume-update", uri)
      }
      val matches = context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
      for (info in matches) {
        context.grantUriPermission(info.activityInfo.packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      try {
        context.startActivity(intent)
      } catch (_: ActivityNotFoundException) {
        throw IllegalStateException("Android has no installer that can open this APK.")
      } catch (_: SecurityException) {
        throw IllegalStateException("Android blocked Yume from handing the APK to the installer.")
      }
    }
  }
}

fun readDevice(context: Context?): Map<String, Any?> {
  if (context == null) return mapOf("available" to false)
  val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
  val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
  val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
  val percent = if (level >= 0 && scale > 0) (level * 100.0) / scale else null
  val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
  val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
  val rawTemp = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
  val tempC = if (rawTemp == Int.MIN_VALUE) null else rawTemp / 10.0
  val rawVoltage = battery?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1) ?: -1
  val voltageMv = if (rawVoltage > 0) rawVoltage else null
  val manager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
  val rawCurrent = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW)
  val currentMicroA = if (rawCurrent == Int.MIN_VALUE || rawCurrent == 0) null else rawCurrent
  val thermal = if (Build.VERSION.SDK_INT >= 29) {
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    power.currentThermalStatus
  } else {
    null
  }
  val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
  val memory = activity.getProcessMemoryInfo(intArrayOf(Process.myPid()))
  val rssMb = if (memory.isNotEmpty()) memory[0].totalPss / 1024 else null
  return mapOf(
    "available" to true,
    "batteryPercent" to percent,
    "charging" to charging,
    "tempC" to tempC,
    "currentMicroA" to currentMicroA,
    "voltageMv" to voltageMv,
    "thermalStatus" to thermal,
    "appRssMb" to rssMb,
    "appCpuPercent" to cpuPercent(),
  )
}

private fun cpuPercent(): Double? {
  val first = procTicks() ?: return null
  val started = SystemClock.elapsedRealtime()
  Thread.sleep(200)
  val second = procTicks() ?: return null
  val elapsed = (SystemClock.elapsedRealtime() - started) / 1000.0
  if (elapsed <= 0) return null
  val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
  val cpuSeconds = (second - first) / 100.0
  return (cpuSeconds / elapsed / cores * 100.0).coerceIn(0.0, 100.0)
}

private fun procTicks(): Long? {
  return try {
    val parts = File("/proc/self/stat").readText().substringAfter(") ").split(" ")
    val utime = parts.getOrNull(11)?.toLongOrNull() ?: return null
    val stime = parts.getOrNull(12)?.toLongOrNull() ?: return null
    utime + stime
  } catch (_: Exception) {
    null
  }
}
