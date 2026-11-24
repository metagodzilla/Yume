package expo.modules.yumequeue

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class YumeQueueModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("YumeQueue")
    Events("action")
    Function("update") { title: String, body: String, progress: Int, count: Int ->
      val context = appContext.reactContext
      if (context != null) {
        YumeQueueBridge.onAction = { action -> sendEvent("action", mapOf("type" to action)) }
        YumeQueueService.start(context, title, body, progress, count)
      }
    }
    Function("stop") {
      val context = appContext.reactContext
      if (context != null) YumeQueueService.stop(context)
    }
  }
}
