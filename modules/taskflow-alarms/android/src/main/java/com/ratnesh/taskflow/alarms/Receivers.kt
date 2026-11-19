package com.ratnesh.taskflow.alarms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** The registered alarm went off: show what is due and register the next one. */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    AlarmRuntime.rearm(context, showDue = true)
  }
}

/** Mark completed or Snooze on a notification. */
class ActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    AlarmRuntime.handleAction(context, intent)
  }
}

/**
 * The phone restarted, the app was updated, or the time or time zone changed:
 * Android forgets alarms on restart, and wall-clock alarms need new instants
 * in a new zone. Alarms missed while the phone was off are shown if they are
 * less than six hours late.
 */
class SystemReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    AlarmRuntime.rearm(context, showDue = true)
  }
}
