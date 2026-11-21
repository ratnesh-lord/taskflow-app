package com.ratnesh.taskflow.alarms

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.util.TypedValue
import android.view.View
import android.widget.FrameLayout
import android.widget.RemoteViews
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import expo.modules.backgroundtask.BackgroundTaskConsumer
import expo.modules.interfaces.taskManager.TaskServiceProviderHelper
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.math.max

private const val TAG = "TaskflowWidgets"

/** The four home-screen widgets. Each draws from the same data; see WidgetUpdater. */
enum class WidgetKind(val key: String, val provider: Class<out AppWidgetProvider>) {
  TODAY("today", TodayWidget::class.java),
  PENDING("pending", PendingWidget::class.java),
  PRODUCTIVITY("productivity", ProductivityWidget::class.java),
  NEXT("next", NextReminderWidget::class.java),
  ;

  companion object {
    fun of(key: String): WidgetKind? = values().firstOrNull { it.key == key }
  }
}

/** Android asks a widget to draw when it is added, resized, restored, or every 30 minutes. */
abstract class TaskflowWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    WidgetUpdater.refreshAll(context)
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    WidgetUpdater.refreshAll(context)
  }

  override fun onDisabled(context: Context) {
    WidgetUpdater.refreshAll(context)
  }
}

class TodayWidget : TaskflowWidget()
class PendingWidget : TaskflowWidget()
class ProductivityWidget : TaskflowWidget()
class NextReminderWidget : TaskflowWidget()

/** Taps on widgets, and the timer that redraws them at midnight and after deadlines. */
class WidgetReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      WidgetUpdater.ACTION_COMPLETE -> WidgetUpdater.complete(context, intent)
      WidgetUpdater.ACTION_REFRESH -> {
        WidgetUpdater.refreshAll(context)
        WidgetSync.request(context, refresh = true)
      }
      WidgetUpdater.ACTION_TICK -> WidgetUpdater.refreshAll(context)
      WidgetUpdater.ACTION_CHECK -> WidgetCheck.run(context, intent)
    }
  }
}

/** Everything a widget needs to draw, read once per redraw. */
class WidgetSnapshot(
  val state: WidgetStore.State,
  val theme: String,
  val done: Set<String>,
  val next: NextReminder?,
  val now: Long,
  val zone: ZoneId,
  val hour12: Boolean,
) {
  val today: LocalDate = java.time.Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
  val nowLocal: LocalDateTime = java.time.Instant.ofEpochMilli(now).atZone(zone).toLocalDateTime()

  /** Today's data, without rows ticked off since the app last sent it; null when there is none for today. */
  val day: WidgetDay? = (state as? WidgetStore.State.Ready)?.data?.let { WidgetMath.pick(it, today.toString()) }?.let { WidgetMath.withoutDone(it, done) }

  companion object {
    fun load(context: Context, raw: String? = null, theme: String? = null): WidgetSnapshot {
      val widgets = WidgetStore(context)
      val alarms = AlarmStore(context)
      val now = System.currentTimeMillis()
      val zone = ZoneId.systemDefault()
      val state = if (raw != null) WidgetStore.parse(raw) else widgets.read()
      val done = alarms.done.keys
      val next = WidgetMath.nextReminder(alarms.plan + alarms.snoozes, alarms.fired, done, now, zone)
      val hour12 = (state as? WidgetStore.State.Ready)?.data?.hour12 ?: !android.text.format.DateFormat.is24HourFormat(context)
      return WidgetSnapshot(state, theme ?: widgets.theme, done, next, now, zone, hour12)
    }
  }
}

object WidgetUpdater {
  const val ACTION_COMPLETE = "com.ratnesh.taskflow.widgets.COMPLETE"
  const val ACTION_REFRESH = "com.ratnesh.taskflow.widgets.REFRESH"
  const val ACTION_TICK = "com.ratnesh.taskflow.widgets.TICK"
  const val ACTION_CHECK = "com.ratnesh.taskflow.widgets.CHECK"

  fun ids(context: Context, kind: WidgetKind): IntArray =
    AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, kind.provider))

  /** Redraw every TaskFlow widget on the home screen and set the next redraw. */
  @Synchronized
  fun refreshAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val snap = WidgetSnapshot.load(context)
    var any = false
    for (kind in WidgetKind.values()) {
      for (id in manager.getAppWidgetIds(ComponentName(context, kind.provider))) {
        any = true
        try {
          val size = sizeOf(manager.getAppWidgetOptions(id), kind)
          manager.updateAppWidget(id, WidgetRender.build(context, kind, snap, size.first, size.second))
        } catch (e: Exception) {
          Log.w(TAG, "Could not draw the ${kind.key} widget", e)
        }
      }
    }
    scheduleTick(context, if (any) nextTick(snap) else null)
  }

  /** Width and height in dp, as the launcher reports them (portrait), with the widget's minimum as a fallback. */
  fun sizeOf(options: Bundle?, kind: WidgetKind): Pair<Int, Int> {
    val w = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) ?: 0
    val h = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) ?: 0
    val (dw, dh) = when (kind) {
      WidgetKind.TODAY -> 320 to 180
      WidgetKind.NEXT -> 320 to 72
      else -> 160 to 160
    }
    return (if (w > 0) w else dw) to (if (h > 0) h else dh)
  }

  private fun nextTick(snap: WidgetSnapshot): Long {
    val local = WidgetMath.nextRefresh(snap.day, snap.nowLocal).atZone(snap.zone).toInstant().toEpochMilli()
    val reminder = snap.next?.at?.plus(60_000L)
    return if (reminder != null && reminder < local) reminder else local
  }

  private fun scheduleTick(context: Context, at: Long?) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = PendingIntent.getBroadcast(
      context, 7100, Intent(context, WidgetReceiver::class.java).setAction(ACTION_TICK),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    // Not a wake-up alarm: if the phone is asleep, the redraw waits until it wakes.
    if (at == null) am.cancel(pi) else am.set(AlarmManager.RTC, at, pi)
  }

  /**
   * A row's box was tapped. Like Mark completed on a notification: the task
   * is put in the done list (its reminders stop, the row disappears), and the
   * tap is queued for the app to save and sync.
   */
  fun complete(context: Context, intent: Intent) {
    val taskId = intent.getStringExtra("taskId") ?: return
    val occurrenceDate = intent.getStringExtra("occurrenceDate")
    val now = System.currentTimeMillis()
    val store = AlarmStore(context)
    store.addDone(AlarmMath.doneKey(taskId, occurrenceDate), now)
    store.queueAction(
      JSONObject().put("type", "complete").put("source", "widget").put("at", now)
        .put("taskId", taskId).put("occurrenceDate", occurrenceDate ?: JSONObject.NULL),
    )
    // Rearming drops the task's alarms and redraws the widgets.
    AlarmRuntime.rearm(context, showDue = false)
    WidgetSync.request(context, refresh = false)
  }

  fun pinSupported(context: Context): Boolean =
    Build.VERSION.SDK_INT >= 26 && AppWidgetManager.getInstance(context).isRequestPinAppWidgetSupported

  /** Ask the launcher to put a widget on the home screen (it shows its own confirmation). */
  fun pin(context: Context, kind: WidgetKind): Boolean {
    if (!pinSupported(context)) return false
    return AppWidgetManager.getInstance(context).requestPinAppWidget(ComponentName(context, kind.provider), null, null)
  }
}

/** Gets a widget tap saved and synced soon, with the app open or closed. */
object WidgetSync {
  private const val WORK = "taskflow-widget-sync"

  fun request(context: Context, refresh: Boolean) {
    val module = TaskflowAlarmsModule.current
    if (module != null) {
      // The app is running: it saves the tap and syncs straight away.
      if (refresh) module.notifyRefresh() else module.notifyAction()
      return
    }
    val work = OneTimeWorkRequestBuilder<WidgetSyncWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(WORK, ExistingWorkPolicy.APPEND_OR_REPLACE, work)
  }
}

/**
 * Runs the app's background work (src/platform/background.ts) now, through
 * the task expo-background-task registered: it saves queued taps, syncs,
 * and sends new plans and widget data. Without a signed-in account there is
 * no registered task and nothing to do.
 */
class WidgetSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val service = TaskServiceProviderHelper.getTaskServiceImpl(applicationContext) ?: return Result.success()
    val consumers = service.getTaskConsumers(applicationContext.packageName).filterIsInstance<BackgroundTaskConsumer>()
    Log.i(TAG, "Saving widget taps: ${consumers.size} background task(s)")
    val runs = consumers.map { consumer ->
      CompletableDeferred<Unit>().also { finished ->
        try {
          consumer.executeTask { finished.complete(Unit) }
        } catch (e: Exception) {
          Log.w(TAG, "Background task failed to start", e)
          finished.complete(Unit)
        }
      }
    }
    withTimeoutOrNull(9 * 60_000L) { runs.awaitAll() }
    return Result.success()
  }
}

/** Builds what each widget shows. */
object WidgetRender {
  private class Colors(val theme: String, context: Context) {
    val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val p: WidgetPalette = if (theme == "dark" || (theme != "light" && night)) WidgetTokens.dark else WidgetTokens.light
    private val followsPhone = theme != "light" && theme != "dark" && Build.VERSION.SDK_INT >= 31

    /** Sets a colour; following the phone, Android 12 and later switch it with dark mode by themselves. */
    fun set(v: RemoteViews, id: Int, method: String, pick: (WidgetPalette) -> Int) {
      if (followsPhone) v.setColorInt(id, method, pick(WidgetTokens.light), pick(WidgetTokens.dark)) else v.setInt(id, method, pick(p))
    }
  }

  private fun text(v: RemoteViews, c: Colors, id: Int, value: CharSequence, size: Float, color: (WidgetPalette) -> Int) {
    v.setTextViewText(id, value)
    v.setTextViewTextSize(id, TypedValue.COMPLEX_UNIT_SP, size)
    c.set(v, id, "setTextColor", color)
  }

  private fun openApp(context: Context, link: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link)).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun broadcast(context: Context, action: String, requestCode: Int, extras: Intent.() -> Unit = {}): PendingIntent {
    val intent = Intent(context, WidgetReceiver::class.java).apply {
      this.action = action
      extras()
    }
    return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun build(context: Context, kind: WidgetKind, snap: WidgetSnapshot, widthDp: Int, heightDp: Int): RemoteViews {
    val c = Colors(snap.theme, context)
    val message = when (val s = snap.state) {
      WidgetStore.State.Empty -> "Open TaskFlow once to show your tasks here."
      WidgetStore.State.SignedOut -> "Sign in to TaskFlow to show your tasks here."
      is WidgetStore.State.Ready -> if (kind != WidgetKind.NEXT && snap.day == null) "Open TaskFlow to bring this up to date." else null
    }
    if (message != null) return message(context, c, kind, message)
    return when (kind) {
      WidgetKind.TODAY -> today(context, c, snap, snap.day!!, heightDp)
      WidgetKind.PENDING -> pending(context, c, snap, snap.day!!)
      WidgetKind.PRODUCTIVITY -> productivity(context, c, snap, snap.day!!, widthDp)
      WidgetKind.NEXT -> next(context, c, snap)
    }
  }

  private fun message(context: Context, c: Colors, kind: WidgetKind, words: String): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.tf_widget_message)
    c.set(v, R.id.tf_root, "setBackgroundColor") { it.background }
    text(v, c, R.id.tf_date, "TaskFlow", WidgetTokens.LABEL) { it.textSecondary }
    text(v, c, R.id.tf_text, words, if (kind == WidgetKind.NEXT) WidgetTokens.CAPTION else WidgetTokens.ROW) { it.text }
    v.setOnClickPendingIntent(R.id.tf_root, openApp(context, "taskflow://", 7000 + kind.ordinal))
    return v
  }

  private fun today(context: Context, c: Colors, snap: WidgetSnapshot, day: WidgetDay, heightDp: Int): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.tf_widget_today)
    c.set(v, R.id.tf_root, "setBackgroundColor") { it.background }
    text(v, c, R.id.tf_date, day.heading, WidgetTokens.LABEL) { it.textSecondary }
    val title = WidgetMath.leftWords(day) + if (day.overdue > 0) " · ${day.overdue} overdue" else ""
    text(v, c, R.id.tf_title, title, WidgetTokens.HEADING) { it.text }
    v.setOnClickPendingIntent(R.id.tf_header, openApp(context, "taskflow://", 7010))

    c.set(v, R.id.tf_refresh, "setColorFilter") { it.textSecondary }
    v.setOnClickPendingIntent(R.id.tf_refresh, broadcast(context, WidgetUpdater.ACTION_REFRESH, 7011))
    c.set(v, R.id.tf_add, "setBackgroundColor") { it.accent }
    c.set(v, R.id.tf_add, "setColorFilter") { it.onAccent }
    v.setOnClickPendingIntent(R.id.tf_add, openApp(context, "taskflow://add", 7012))

    // Header 12 + 44 + 8, bottom 4; each row 44.
    val fit = ((heightDp - 68) / WidgetTokens.ROW_HEIGHT).coerceIn(1, 8)
    v.removeAllViews(R.id.tf_rows)
    if (day.rows.isEmpty()) {
      v.setViewVisibility(R.id.tf_rows, View.GONE)
      v.setViewVisibility(R.id.tf_empty, View.VISIBLE)
      val words = if (day.done > 0) "Everything for today is done." else "Nothing due today. Tap + to add a task."
      text(v, c, R.id.tf_empty, words, WidgetTokens.ROW) { it.textSecondary }
      v.setOnClickPendingIntent(R.id.tf_empty, openApp(context, "taskflow://", 7013))
      return v
    }
    v.setViewVisibility(R.id.tf_rows, View.VISIBLE)
    v.setViewVisibility(R.id.tf_empty, View.GONE)
    for (row in day.rows.take(fit)) v.addView(R.id.tf_rows, row(context, c, row))
    return v
  }

  private fun row(context: Context, c: Colors, row: WidgetRow): RemoteViews {
    val r = RemoteViews(context.packageName, R.layout.tf_widget_row)
    c.set(r, R.id.tf_divider, "setBackgroundColor") { it.divider }
    c.set(r, R.id.tf_check, "setColorFilter") { if (row.earlier) it.overdue else it.textSecondary }
    r.setContentDescription(R.id.tf_check, "Mark completed: ${row.title}")
    val code = row.doneKey.hashCode()
    r.setOnClickPendingIntent(
      R.id.tf_check,
      broadcast(context, WidgetUpdater.ACTION_COMPLETE, code) {
        data = Uri.parse("taskflow-widget://complete/${Uri.encode(row.doneKey)}")
        putExtra("taskId", row.taskId)
        putExtra("occurrenceDate", row.occurrenceDate)
      },
    )
    text(r, c, R.id.tf_label, row.label, WidgetTokens.CAPTION) { if (row.earlier) it.overdue else it.textSecondary }
    text(r, c, R.id.tf_text, row.title, WidgetTokens.ROW) { it.text }
    r.setOnClickPendingIntent(R.id.tf_row, openApp(context, "taskflow://task/${row.taskId}", code))
    when (row.priority) {
      "critical", "high" -> {
        r.setImageViewResource(R.id.tf_priority, R.drawable.tf_widget_square_fill)
        c.set(r, R.id.tf_priority, "setColorFilter") { if (row.priority == "critical") it.accent else it.text }
        r.setContentDescription(R.id.tf_priority, if (row.priority == "critical") "Critical priority" else "High priority")
        r.setViewVisibility(R.id.tf_priority, View.VISIBLE)
      }
      "medium" -> {
        r.setImageViewResource(R.id.tf_priority, R.drawable.tf_widget_square_outline)
        c.set(r, R.id.tf_priority, "setColorFilter") { it.text }
        r.setViewVisibility(R.id.tf_priority, View.VISIBLE)
      }
      else -> r.setViewVisibility(R.id.tf_priority, View.INVISIBLE)
    }
    return r
  }

  private fun pending(context: Context, c: Colors, snap: WidgetSnapshot, day: WidgetDay): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.tf_widget_pending)
    c.set(v, R.id.tf_root, "setBackgroundColor") { it.background }
    text(v, c, R.id.tf_date, "Pending", WidgetTokens.LABEL) { it.textSecondary }
    text(v, c, R.id.tf_number, day.pending.toString(), WidgetTokens.NUMBER) { it.text }
    if (day.overdue > 0) {
      text(v, c, R.id.tf_line1, "${day.overdue} overdue", WidgetTokens.CAPTION) { it.overdue }
    } else {
      text(v, c, R.id.tf_line1, "Nothing overdue", WidgetTokens.CAPTION) { it.textSecondary }
    }
    if (day.important > 0) {
      text(v, c, R.id.tf_line2, "${day.important} high priority", WidgetTokens.CAPTION) { it.text }
      v.setViewVisibility(R.id.tf_line2, View.VISIBLE)
    } else {
      v.setViewVisibility(R.id.tf_line2, View.GONE)
    }
    val deadline = WidgetMath.nextDeadline(day, snap.nowLocal)
    text(v, c, R.id.tf_line3, deadline?.let { "Next deadline ${it.label}" } ?: "No more deadlines today", WidgetTokens.CAPTION) { it.textSecondary }
    v.setOnClickPendingIntent(R.id.tf_root, openApp(context, "taskflow://", 7020))
    return v
  }

  private fun productivity(context: Context, c: Colors, snap: WidgetSnapshot, day: WidgetDay, widthDp: Int): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.tf_widget_productivity)
    c.set(v, R.id.tf_root, "setBackgroundColor") { it.background }
    text(v, c, R.id.tf_date, "Today", WidgetTokens.LABEL) { it.textSecondary }
    text(v, c, R.id.tf_number, "${WidgetMath.percent(day)}%", WidgetTokens.NUMBER) { it.text }
    text(v, c, R.id.tf_line1, "${day.done} done · ${day.pending} left", WidgetTokens.CAPTION) { it.textSecondary }
    val todayIndex = snap.today.dayOfWeek.value - 1
    v.setImageViewBitmap(R.id.tf_bars, bars(context, day.week, todayIndex, widthDp - 32, c.p))
    val week = day.week.sum()
    v.setContentDescription(R.id.tf_bars, "Tasks completed each day this week, $week so far")
    text(v, c, R.id.tf_line2, if (week == 1) "1 done this week" else "$week done this week", WidgetTokens.CAPTION) { it.textSecondary }
    v.setOnClickPendingIntent(R.id.tf_root, openApp(context, "taskflow://completed", 7030))
    return v
  }

  /** Seven square bars, Monday to Sunday: done days in text colour, today in the accent, days to come as a line. */
  fun bars(context: Context, week: List<Int>, todayIndex: Int, widthDp: Int, p: WidgetPalette): Bitmap {
    val d = context.resources.displayMetrics.density
    val w = max(1, (max(widthDp, 70) * d).toInt())
    val h = max(1, (28 * d).toInt())
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val paint = Paint().apply { isAntiAlias = false }
    val gap = 4 * d
    val bw = (w - gap * 6) / 7
    val most = max(1, week.maxOrNull() ?: 0)
    val line = 2 * d
    for (i in 0 until 7) {
      val n = week.getOrElse(i) { 0 }
      val bh = if (i > todayIndex || n == 0) line else max(line, h * n.toFloat() / most)
      paint.color = when {
        i == todayIndex -> p.accent
        i > todayIndex || n == 0 -> p.divider
        else -> p.text
      }
      val x = i * (bw + gap)
      canvas.drawRect(x, h - bh, x + bw, h.toFloat(), paint)
    }
    return bmp
  }

  private fun next(context: Context, c: Colors, snap: WidgetSnapshot): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.tf_widget_next)
    c.set(v, R.id.tf_root, "setBackgroundColor") { it.background }
    c.set(v, R.id.tf_icon, "setColorFilter") { it.accent }
    text(v, c, R.id.tf_date, "Next reminder", WidgetTokens.LABEL) { it.textSecondary }
    val n = snap.next
    if (n == null) {
      text(v, c, R.id.tf_text, "No reminders coming up", WidgetTokens.ROW) { it.textSecondary }
      v.setViewVisibility(R.id.tf_when, View.GONE)
      v.setOnClickPendingIntent(R.id.tf_root, openApp(context, "taskflow://reminders", 7040))
      return v
    }
    text(v, c, R.id.tf_text, n.title, WidgetTokens.ROW) { it.text }
    v.setViewVisibility(R.id.tf_when, View.VISIBLE)
    text(v, c, R.id.tf_number, WidgetMath.time(n.at, snap.zone, snap.hour12), WidgetTokens.TIME) { it.text }
    text(v, c, R.id.tf_line1, WidgetMath.dayWord(n.at, snap.zone, snap.today), WidgetTokens.CAPTION) { it.textSecondary }
    v.setOnClickPendingIntent(R.id.tf_root, openApp(context, n.taskId?.let { "taskflow://task/$it" } ?: "taskflow://reminders", 7041))
    return v
  }
}

/**
 * A self-check for the emulator test in CI (scripts/ci/android-smoke.sh): draws
 * each widget inside the app, the way a launcher would, and saves pictures of
 * them under the app's files. Only the system or a root shell can send it
 * (the receiver is not exported). Data passed in is drawn but not saved.
 */
object WidgetCheck {
  fun run(context: Context, intent: Intent) {
    val raw = intent.getStringExtra("data64")?.let { String(Base64.decode(it, Base64.DEFAULT)) }
    val dir = File(context.filesDir, "widget-check").apply { mkdirs() }
    for (theme in listOf("light", "dark")) {
      val snap = WidgetSnapshot.load(context, raw, theme)
      for (kind in WidgetKind.values()) {
        val (w, h) = WidgetUpdater.sizeOf(null, kind)
        try {
          val views = WidgetRender.build(context, kind, snap, w, h)
          val parent = FrameLayout(context)
          val view = views.apply(context, parent)
          val d = context.resources.displayMetrics.density
          val pw = (w * d).toInt()
          val ph = (h * d).toInt()
          view.measure(View.MeasureSpec.makeMeasureSpec(pw, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(ph, View.MeasureSpec.EXACTLY))
          view.layout(0, 0, pw, ph)
          val bmp = Bitmap.createBitmap(pw, ph, Bitmap.Config.ARGB_8888)
          view.draw(Canvas(bmp))
          FileOutputStream(File(dir, "${kind.key}-$theme.png")).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
          Log.i(TAG, "Widget check: ${kind.key} ($theme) drawn")
        } catch (e: Exception) {
          Log.e(TAG, "Widget check: ${kind.key} ($theme) FAILED", e)
        }
      }
    }
  }
}
