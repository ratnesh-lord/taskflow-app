package com.ratnesh.taskflow.alarms

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.time.ZoneId

/**
 * Arms the next alarm, shows notifications and handles their buttons.
 * Only the earliest alarm is registered with Android at any time; when it
 * goes off, everything due is shown and the next one is registered.
 */
object AlarmRuntime {
  const val CHANNEL_REMINDERS = "reminders"
  const val CHANNEL_SUMMARIES = "summaries"
  const val ACTION_COMPLETE = "com.ratnesh.taskflow.alarms.COMPLETE"
  const val ACTION_SNOOZE = "com.ratnesh.taskflow.alarms.SNOOZE"

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = context.getSystemService(NotificationManager::class.java) ?: return
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL_REMINDERS, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Reminders you set on tasks"
        enableVibration(true)
      },
    )
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL_SUMMARIES, "Daily summaries", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "The morning plan and the evening check"
      },
    )
  }

  /** Take a new plan from the app. Nothing already in the past goes off because of it. */
  @Synchronized
  fun setPlan(context: Context, json: String): Map<String, Any?> {
    val store = AlarmStore(context)
    val root = JSONObject(json)
    val generatedAt = root.optLong("generatedAt", System.currentTimeMillis())
    val alarms = PlanJson.parseAlarms(root.optJSONArray("alarms")?.toString() ?: "[]")
    val now = System.currentTimeMillis()
    val zone = ZoneId.systemDefault()

    store.plan = alarms
    // Taps the app has already taken in are reflected in the new plan.
    store.done = store.done.filterValues { it >= generatedAt }
    val snoozes = store.snoozes.filter { (AlarmMath.fireTime(it, zone) ?: 0) > now - AlarmMath.GRACE_MS }
    store.snoozes = snoozes
    val keep = (alarms + snoozes).map { it.key }.toSet()
    val past = alarms.filter { (AlarmMath.fireTime(it, zone) ?: 0) <= now }.map { it.key }
    store.fired = store.fired.filter { it in keep }.toSet() + past

    val next = rearm(context, showDue = false)
    return mapOf("alarms" to alarms.size, "next" to next?.toDouble())
  }

  /**
   * Show whatever is due (when [showDue]), forget what is too old, and register
   * the next alarm. Returns its time, or null when nothing is left.
   */
  @Synchronized
  fun rearm(context: Context, showDue: Boolean): Long? {
    val store = AlarmStore(context)
    val now = System.currentTimeMillis()
    val zone = ZoneId.systemDefault()
    val all = store.plan + store.snoozes
    val done = store.done.keys
    var fired = store.fired

    if (showDue) {
      ensureChannels(context)
      for (a in AlarmMath.due(all, fired, done, now, zone)) {
        AlarmMath.text(a, done)?.let { show(context, a, it, AlarmMath.fireTime(a, zone) ?: now) }
        fired = fired + a.key
      }
    }
    fired = fired + AlarmMath.expired(all, fired, now, zone).map { it.key }
    store.fired = fired

    val next = AlarmMath.next(all, fired, done, now, zone)
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = PendingIntent.getBroadcast(
      context, 0, Intent(context, AlarmReceiver::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    if (next == null) {
      am.cancel(pi)
    } else if (canExact(context)) {
      am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi)
    } else {
      // Without exact-alarm permission Android may deliver it a few minutes late.
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi)
    }
    return next
  }

  fun canExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 31) return true
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return am.canScheduleExactAlarms()
  }

  private fun openIntent(context: Context, link: String?, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link ?: "taskflow://")).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun actionIntent(context: Context, a: PlannedAlarm, action: String, minutes: Int, requestCode: Int): PendingIntent {
    val intent = Intent(context, ActionReceiver::class.java).apply {
      this.action = action
      putExtra("alarm", PlanJson.alarmToJson(a).toString())
      putExtra("minutes", minutes)
      putExtra("notificationId", a.key.hashCode())
    }
    return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  @SuppressLint("MissingPermission")
  fun show(context: Context, a: PlannedAlarm, shown: Shown, firedAt: Long) {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    val id = a.key.hashCode()
    val isReminder = a.channel == CHANNEL_REMINDERS
    val builder = NotificationCompat.Builder(context, if (isReminder) CHANNEL_REMINDERS else CHANNEL_SUMMARIES)
      .setSmallIcon(R.drawable.taskflow_notification)
      .setContentTitle(shown.title)
      .setContentText(shown.body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(shown.body))
      .setAutoCancel(true)
      .setWhen(firedAt)
      .setShowWhen(true)
      .setCategory(if (isReminder) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_RECOMMENDATION)
      .setPriority(if (isReminder) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
      .setContentIntent(openIntent(context, a.link, id))
    if (a.actions && a.taskId != null) {
      builder.addAction(0, "Mark completed", actionIntent(context, a, ACTION_COMPLETE, 0, id * 4 + 1))
      builder.addAction(0, "Snooze 10 min", actionIntent(context, a, ACTION_SNOOZE, 10, id * 4 + 2))
      builder.addAction(0, "Snooze 30 min", actionIntent(context, a, ACTION_SNOOZE, 30, id * 4 + 3))
    }
    try {
      NotificationManagerCompat.from(context).notify(id, builder.build())
    } catch (e: SecurityException) {
      // Permission withdrawn between the check and the call: nothing to show.
    }
  }

  /** A button on a notification was tapped. */
  fun handleAction(context: Context, intent: Intent) {
    val a = intent.getStringExtra("alarm")?.let { PlanJson.parseAlarm(JSONObject(it)) } ?: return
    val store = AlarmStore(context)
    val now = System.currentTimeMillis()
    NotificationManagerCompat.from(context).cancel(intent.getIntExtra("notificationId", a.key.hashCode()))
    val event = JSONObject().put("at", now).put("taskId", a.taskId).put("occurrenceDate", a.occurrenceDate ?: JSONObject.NULL)
      .put("reminderId", a.reminderId ?: JSONObject.NULL)
    when (intent.action) {
      ACTION_COMPLETE -> {
        val taskId = a.taskId ?: return
        store.addDone(AlarmMath.doneKey(taskId, a.occurrenceDate), now)
        event.put("type", "complete")
      }
      ACTION_SNOOZE -> {
        val minutes = intent.getIntExtra("minutes", 10).coerceIn(1, 24 * 60)
        val until = now + minutes * 60_000L
        store.snoozes = store.snoozes + a.copy(key = "snooze:${a.key}:$until", local = null, zone = null, at = until)
        event.put("type", "snooze").put("until", until)
      }
      else -> return
    }
    store.queueAction(event)
    rearm(context, showDue = false)
    TaskflowAlarmsModule.current?.notifyAction()
  }

  /** A real alarm through the whole path, [seconds] from now. */
  fun test(context: Context, seconds: Int): Long {
    val store = AlarmStore(context)
    val at = System.currentTimeMillis() + seconds.coerceIn(1, 3600) * 1000L
    store.snoozes = store.snoozes + PlannedAlarm(
      key = "test:$at", kind = "test", at = at, channel = CHANNEL_REMINDERS,
      title = "TaskFlow test reminder", body = "Reminders reach you like this, even with the app closed.", link = "taskflow://",
    )
    rearm(context, showDue = false)
    return at
  }

  fun status(context: Context): Map<String, Any?> {
    val notifications = NotificationManagerCompat.from(context).areNotificationsEnabled()
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return mapOf(
      "notifications" to notifications,
      "exactAlarms" to canExact(context),
      "batteryUnrestricted" to power.isIgnoringBatteryOptimizations(context.packageName),
      "sdk" to Build.VERSION.SDK_INT,
      "manufacturer" to Build.MANUFACTURER,
      "planned" to AlarmStore(context).plan.size,
      "next" to AlarmStore(context).let { st ->
        AlarmMath.next(st.plan + st.snoozes, st.fired, st.done.keys, System.currentTimeMillis(), ZoneId.systemDefault())?.toDouble()
      },
    )
  }

  @SuppressLint("BatteryLife")
  fun openSettings(context: Context, kind: String) {
    val pkg = context.packageName
    val intent = when (kind) {
      "notifications" -> if (Build.VERSION.SDK_INT >= 26) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
      }
      "exactAlarms" -> if (Build.VERSION.SDK_INT >= 31) {
        Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$pkg"))
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
      }
      "battery" -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$pkg"))
      else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
    }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(intent)
    } catch (e: Exception) {
      context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }
}
