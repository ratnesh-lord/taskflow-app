package com.ratnesh.taskflow.alarms

import java.time.LocalDateTime
import java.time.ZoneId

/**
 * The plain rules of the alarm runtime, with no Android in them, so they are
 * tested on an ordinary JVM (see src/test).
 *
 * An alarm is planned by the app either at a wall-clock time ("2026-11-20T18:30",
 * meaning half past six wherever the phone is when it goes off) or at a fixed
 * instant. Wall-clock times are turned into instants only when alarms are
 * armed, so a change of time zone moves them with the clock.
 */
data class SummaryItem(val taskId: String, val occurrenceDate: String?, val title: String)

data class PlannedAlarm(
  val key: String,
  /** reminder | morning | evening | test */
  val kind: String,
  /** Wall-clock time, "yyyy-MM-ddTHH:mm", in [zone] or the phone's zone. */
  val local: String? = null,
  val zone: String? = null,
  /** A fixed instant, in ms since 1970; used instead of [local] when set. */
  val at: Long? = null,
  val channel: String = "reminders",
  val title: String = "",
  val body: String = "",
  /** For summaries: the title when one item is left. "{n}" in [title] is the count. */
  val titleOne: String? = null,
  val taskId: String? = null,
  val occurrenceDate: String? = null,
  val reminderId: String? = null,
  /** Show Mark completed and Snooze buttons. */
  val actions: Boolean = false,
  val items: List<SummaryItem> = emptyList(),
  /** Deep link opened by tapping the notification. */
  val link: String? = null,
)

/** What a notification says when it is shown. */
data class Shown(val title: String, val body: String)

object AlarmMath {
  /** How late a missed alarm (phone off, app updated) may still be shown. */
  const val GRACE_MS = 6L * 60 * 60 * 1000

  fun doneKey(taskId: String, occurrenceDate: String?) = "$taskId|${occurrenceDate ?: ""}"

  /** When the alarm goes off, or null if its time cannot be read. */
  fun fireTime(a: PlannedAlarm, deviceZone: ZoneId): Long? {
    a.at?.let { return it }
    val local = a.local ?: return null
    val ldt = try {
      LocalDateTime.parse(local)
    } catch (e: Exception) {
      return null
    }
    val zone = a.zone?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: deviceZone
    // In a daylight-saving gap the time moves forward by the gap; in an overlap the first one counts.
    return ldt.atZone(zone).toInstant().toEpochMilli()
  }

  /** The task this alarm is about was ticked off from a notification. */
  fun isDone(a: PlannedAlarm, done: Set<String>): Boolean =
    a.taskId != null && done.contains(doneKey(a.taskId, a.occurrenceDate))

  /** Alarms to show now: due, not shown before, not done, and not more than [GRACE_MS] late. */
  fun due(alarms: List<PlannedAlarm>, fired: Set<String>, done: Set<String>, now: Long, zone: ZoneId): List<PlannedAlarm> =
    alarms.filter { a ->
      val t = fireTime(a, zone) ?: return@filter false
      t <= now && now - t <= GRACE_MS && a.key !in fired && !isDone(a, done)
    }

  /** Alarms whose time has passed beyond the grace period: never shown, just forgotten. */
  fun expired(alarms: List<PlannedAlarm>, fired: Set<String>, now: Long, zone: ZoneId): List<PlannedAlarm> =
    alarms.filter { a ->
      val t = fireTime(a, zone)
      a.key !in fired && (t == null || now - t > GRACE_MS)
    }

  /** The next time anything must go off, or null when nothing is left. */
  fun next(alarms: List<PlannedAlarm>, fired: Set<String>, done: Set<String>, now: Long, zone: ZoneId): Long? =
    alarms
      .filter { it.key !in fired && !isDone(it, done) }
      .mapNotNull { fireTime(it, zone) }
      .filter { it > now }
      .minOrNull()

  /**
   * The words of a notification. A summary leaves out items ticked off since
   * it was planned, and is not shown at all when none are left.
   */
  fun text(a: PlannedAlarm, done: Set<String>): Shown? {
    if (a.kind != "morning" && a.kind != "evening") return Shown(a.title, a.body)
    val left = a.items.filter { !done.contains(doneKey(it.taskId, it.occurrenceDate)) }
    if (left.isEmpty()) return null
    val title = if (left.size == 1 && a.titleOne != null) a.titleOne else a.title.replace("{n}", left.size.toString())
    val shownTitles = left.take(4).joinToString(", ") { it.title }
    val more = left.size - 4
    val body = if (more > 0) "$shownTitles and $more more" else shownTitles
    return Shown(title, body)
  }
}
