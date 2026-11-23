package com.ratnesh.taskflow.alarms

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt

/**
 * The plain rules of the home-screen widgets, with no Android in them, so
 * they are tested on an ordinary JVM (kotlin-tests/WidgetMathTest.kt).
 *
 * The app works out what the widgets show (src/core/widgets.ts) for today
 * and tomorrow; these rules pick the day matching the phone's date, take
 * out rows ticked off on the widget since, and find the next deadline.
 */
data class WidgetRow(
  val taskId: String,
  val occurrenceDate: String?,
  val title: String,
  val label: String,
  /** "yyyy-MM-ddTHH:mm" or "yyyy-MM-dd". */
  val due: String,
  val priority: String,
  val earlier: Boolean,
  /** The row's colour bar and priority mark, as #RRGGBB for light and dark; null for none (older app data). */
  val color: ColorPair? = null,
  val priorityColor: ColorPair? = null,
) {
  val doneKey: String get() = AlarmMath.doneKey(taskId, occurrenceDate)
}

data class ColorPair(val light: String, val dark: String)

data class WidgetDay(
  val date: String,
  val heading: String,
  val rows: List<WidgetRow>,
  val pending: Int,
  val overdue: Int,
  val done: Int,
  val important: Int,
  val week: List<Int>,
)

data class WidgetData(
  val generatedAt: Long,
  val hour12: Boolean,
  val days: List<WidgetDay>,
)

/** The next reminder, as the Next reminder widget shows it. */
data class NextReminder(val title: String, val taskId: String?, val at: Long)

object WidgetMath {
  /** The day to show on [today], or null when the app's data is older than that. */
  fun pick(data: WidgetData, today: String): WidgetDay? = data.days.firstOrNull { it.date == today }

  /** The day without rows ticked off on the widget since the app last sent data. */
  fun withoutDone(day: WidgetDay, hidden: Set<String>): WidgetDay {
    if (hidden.isEmpty()) return day
    val gone = day.rows.filter { it.doneKey in hidden }
    if (gone.isEmpty()) return day
    val earlier = gone.count { it.earlier }
    val today = gone.size - earlier
    val important = gone.count { it.priority == "high" || it.priority == "critical" }
    return day.copy(
      rows = day.rows.filter { it.doneKey !in hidden },
      pending = (day.pending - today).coerceAtLeast(0),
      overdue = (day.overdue - earlier).coerceAtLeast(0),
      done = day.done + gone.size,
      important = (day.important - important).coerceAtLeast(0),
      week = weekWithToday(day, gone.size),
    )
  }

  private fun weekWithToday(day: WidgetDay, extra: Int): List<Int> {
    val index = runCatching { LocalDate.parse(day.date).dayOfWeek.value - 1 }.getOrNull() ?: return day.week
    return day.week.mapIndexed { i, n -> if (i == index) n + extra else n }
  }

  /** Same rounding as the Today screen: done out of everything scheduled today. */
  fun percent(day: WidgetDay): Int {
    val scheduled = day.done + day.pending
    return if (scheduled == 0) 0 else (day.done * 100.0 / scheduled).roundToInt()
  }

  /** The first of today's timed rows still to come. */
  fun nextDeadline(day: WidgetDay, now: LocalDateTime): WidgetRow? =
    day.rows.firstOrNull { !it.earlier && it.due.length > 10 && parse(it.due)?.isAfter(now) == true }

  /**
   * When the widgets next need drawing again without any new data: the next
   * deadline (the Pending widget names it) or just after midnight, whichever
   * comes first.
   */
  fun nextRefresh(day: WidgetDay?, now: LocalDateTime): LocalDateTime {
    val midnight = now.toLocalDate().plusDays(1).atStartOfDay().plusMinutes(1)
    val deadline = day?.let { nextDeadline(it, now) }?.let { parse(it.due) }?.plusMinutes(1)
    return if (deadline != null && deadline.isBefore(midnight)) deadline else midnight
  }

  /** The soonest reminder still to go off (not summaries, not the test). */
  fun nextReminder(alarms: List<PlannedAlarm>, fired: Set<String>, done: Set<String>, now: Long, zone: ZoneId): NextReminder? =
    alarms
      .filter { it.kind == "reminder" && it.key !in fired && !AlarmMath.isDone(it, done) }
      .mapNotNull { a -> AlarmMath.fireTime(a, zone)?.takeIf { it > now }?.let { a to it } }
      .minByOrNull { it.second }
      ?.let { (a, t) -> NextReminder(a.title, a.taskId, t) }

  /** "18:30" or "6:30 pm", the app's style. */
  fun time(at: Long, zone: ZoneId, hour12: Boolean): String {
    val t = Instant.ofEpochMilli(at).atZone(zone).toLocalTime()
    if (!hour12) return "%02d:%02d".format(t.hour, t.minute)
    val h = if (t.hour % 12 == 0) 12 else t.hour % 12
    return "%d:%02d %s".format(h, t.minute, if (t.hour < 12) "am" else "pm")
  }

  /** "Today", "Tomorrow", or "Sat 28 Nov". */
  fun dayWord(at: Long, zone: ZoneId, today: LocalDate): String {
    val d = Instant.ofEpochMilli(at).atZone(zone).toLocalDate()
    return when (d) {
      today -> "Today"
      today.plusDays(1) -> "Tomorrow"
      else -> "${d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)} ${d.dayOfMonth} ${d.month.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)}"
    }
  }

  /** "4 left today", "1 left today", "All done for today", "Nothing for today". */
  fun leftWords(day: WidgetDay): String = when {
    day.pending > 0 -> "${day.pending} left today"
    day.done > 0 -> "All done for today"
    else -> "Nothing for today"
  }

  private fun parse(due: String): LocalDateTime? = runCatching { LocalDateTime.parse(due) }.getOrNull()
}
