package com.ratnesh.taskflow.alarms

import android.Manifest
import android.content.Context
import android.os.Build
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** What the app (JavaScript) can ask of the alarm runtime. */
class TaskflowAlarmsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  companion object {
    /** The live module, if the app is running, so notification taps can tell it at once. */
    @Volatile
    var current: TaskflowAlarmsModule? = null
  }

  fun notifyAction() {
    try {
      sendEvent("onAction", mapOf<String, Any?>())
    } catch (e: Exception) {
      // The app is closing; it will read the queue next time.
    }
  }

  override fun definition() = ModuleDefinition {
    Name("TaskflowAlarms")
    Events("onAction")

    OnCreate {
      current = this@TaskflowAlarmsModule
      appContext.reactContext?.let { AlarmRuntime.ensureChannels(it) }
    }
    OnDestroy {
      if (current === this@TaskflowAlarmsModule) current = null
    }

    AsyncFunction("setPlan") { json: String -> AlarmRuntime.setPlan(context, json) }
    AsyncFunction("takeActions") { AlarmStore(context).takeActions() }
    AsyncFunction("status") { AlarmRuntime.status(context) }
    AsyncFunction("test") { seconds: Int -> AlarmRuntime.test(context, seconds).toDouble() }
    Function("openSettings") { kind: String -> AlarmRuntime.openSettings(context, kind) }

    AsyncFunction("requestNotificationPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < 33) {
        promise.resolve(mapOf("granted" to true))
      } else {
        Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.POST_NOTIFICATIONS)
      }
    }
  }
}
