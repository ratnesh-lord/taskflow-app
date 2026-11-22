import com.ratnesh.taskflow.alarms.PlannedAlarm
import com.ratnesh.taskflow.alarms.WidgetData
import com.ratnesh.taskflow.alarms.WidgetDay
import com.ratnesh.taskflow.alarms.WidgetMath
import com.ratnesh.taskflow.alarms.WidgetRow
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime

// A tiny runner, so these tests need nothing but kotlinc: `bash modules/taskflow-alarms/test-kotlin.sh`.
var failures = 0
fun check(name: String, ok: Boolean) {
  println((if (ok) "ok   " else "FAIL ") + name)
  if (!ok) failures++
}

fun ms(text: String, zone: String) = ZonedDateTime.of(LocalDateTime.parse(text), ZoneId.of(zone)).toInstant().toEpochMilli()

fun row(id: String, due: String, label: String, earlier: Boolean = false, priority: String = "medium", occurrence: String? = null) =
  WidgetRow(taskId = id, occurrenceDate = occurrence, title = "Task $id", label = label, due = due, priority = priority, earlier = earlier)

fun main() {
  val india = ZoneId.of("Asia/Kolkata")
  // Sunday 22 November 2026.
  val day = WidgetDay(
    date = "2026-11-22", heading = "Sun 22 Nov",
    rows = listOf(
      row("late", "2026-11-20", "Fri 20 Nov", earlier = true, priority = "high"),
      row("bill", "2026-11-22T13:00", "13:00", priority = "critical"),
      row("water", "2026-11-22T18:00", "18:00", occurrence = "2026-11-22"),
      row("bank", "2026-11-22", "Any", priority = "low"),
    ),
    pending = 3, overdue = 1, done = 2, important = 2, week = listOf(3, 1, 0, 4, 2, 0, 2),
  )
  val tomorrow = day.copy(date = "2026-11-23", heading = "Mon 23 Nov", week = List(7) { 0 })
  val data = WidgetData(generatedAt = 1, hour12 = false, days = listOf(day, tomorrow))

  check("today's data is shown today", WidgetMath.pick(data, "2026-11-22") == day)
  check("after midnight, tomorrow's data is shown without the app", WidgetMath.pick(data, "2026-11-23")?.heading == "Mon 23 Nov")
  check("two days later there is nothing to show (the widget asks to open the app)", WidgetMath.pick(data, "2026-11-24") == null)

  val ticked = WidgetMath.withoutDone(day, setOf("bill|", "late|"))
  check("rows ticked off on the widget disappear", ticked.rows.map { it.taskId } == listOf("water", "bank"))
  check("their counts move from pending and overdue to done",
    ticked.pending == 2 && ticked.overdue == 0 && ticked.done == 4 && ticked.important == 0)
  check("and today's bar grows (Sunday is the seventh)", ticked.week == listOf(3, 1, 0, 4, 2, 0, 4))
  check("a repeating task's tick counts only for its own day",
    WidgetMath.withoutDone(day, setOf("water|2026-11-21")).rows.size == 4 &&
      WidgetMath.withoutDone(day, setOf("water|2026-11-22")).rows.size == 3)
  check("nothing ticked leaves the day as it is", WidgetMath.withoutDone(day, emptySet()) == day)

  check("progress is done out of done plus pending, rounded like the app", WidgetMath.percent(day) == 40)
  check("no tasks today is 0%, not a division by zero", WidgetMath.percent(day.copy(done = 0, pending = 0)) == 0)

  val morning = LocalDateTime.parse("2026-11-22T10:00")
  check("the next deadline is the first timed row still to come", WidgetMath.nextDeadline(day, morning)?.taskId == "bill")
  check("once 13:00 has passed it is 18:00", WidgetMath.nextDeadline(day, LocalDateTime.parse("2026-11-22T13:00"))?.taskId == "water")
  check("overdue and untimed rows are never the next deadline", WidgetMath.nextDeadline(day, LocalDateTime.parse("2026-11-22T19:00")) == null)
  check("the widgets redraw a minute after the next deadline", WidgetMath.nextRefresh(day, morning) == LocalDateTime.parse("2026-11-22T13:01"))
  check("with no deadline left they redraw just after midnight",
    WidgetMath.nextRefresh(day, LocalDateTime.parse("2026-11-22T19:00")) == LocalDateTime.parse("2026-11-23T00:01"))
  check("with no data they still redraw after midnight", WidgetMath.nextRefresh(null, morning) == LocalDateTime.parse("2026-11-23T00:01"))

  val now = ms("2026-11-22T10:00", "Asia/Kolkata")
  val alarms = listOf(
    PlannedAlarm(key = "m", kind = "morning", local = "2026-11-22T11:00", title = "{n} tasks for today"),
    PlannedAlarm(key = "t", kind = "test", at = now + 10_000, title = "TaskFlow test reminder"),
    PlannedAlarm(key = "r1", kind = "reminder", local = "2026-11-22T18:30", title = "Water", taskId = "water", occurrenceDate = "2026-11-22"),
    PlannedAlarm(key = "r2", kind = "reminder", local = "2026-11-22T12:30", title = "Bill", taskId = "bill"),
    PlannedAlarm(key = "r0", kind = "reminder", local = "2026-11-22T09:00", title = "Past", taskId = "past"),
  )
  check("the next reminder skips summaries, the test and what has passed",
    WidgetMath.nextReminder(alarms, emptySet(), emptySet(), now, india)?.title == "Bill")
  check("a reminder ticked off or already shown is skipped",
    WidgetMath.nextReminder(alarms, setOf("r1"), setOf("bill|"), now, india) == null)
  check("a snoozed reminder counts", WidgetMath.nextReminder(
    alarms + PlannedAlarm(key = "snooze:r0:1", kind = "reminder", at = now + 600_000, title = "Past", taskId = "past"),
    emptySet(), emptySet(), now, india,
  )?.at == now + 600_000)

  val at = ms("2026-11-22T18:30", "Asia/Kolkata")
  check("times read 18:30 or 6:30 pm", WidgetMath.time(at, india, false) == "18:30" && WidgetMath.time(at, india, true) == "6:30 pm")
  check("midnight and noon in 12-hour time", WidgetMath.time(ms("2026-11-22T00:05", "Asia/Kolkata"), india, true) == "12:05 am" &&
    WidgetMath.time(ms("2026-11-22T12:00", "Asia/Kolkata"), india, true) == "12:00 pm")
  val today = LocalDate.parse("2026-11-22")
  check("the day reads Today, Tomorrow, or a date",
    WidgetMath.dayWord(at, india, today) == "Today" &&
      WidgetMath.dayWord(ms("2026-11-23T08:00", "Asia/Kolkata"), india, today) == "Tomorrow" &&
      WidgetMath.dayWord(ms("2026-11-28T08:00", "Asia/Kolkata"), india, today) == "Sat 28 Nov")
  check("the header counts what is left",
    WidgetMath.leftWords(day) == "3 left today" && WidgetMath.leftWords(day.copy(pending = 0)) == "All done for today" &&
      WidgetMath.leftWords(day.copy(pending = 0, done = 0)) == "Nothing for today")

  println(if (failures == 0) "All widget rules passed." else "$failures failed.")
  if (failures > 0) kotlin.system.exitProcess(1)
}
