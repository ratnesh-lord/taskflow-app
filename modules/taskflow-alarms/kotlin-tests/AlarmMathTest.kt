import com.ratnesh.taskflow.alarms.AlarmMath
import com.ratnesh.taskflow.alarms.PlannedAlarm
import com.ratnesh.taskflow.alarms.SummaryItem
import java.time.ZoneId
import java.time.ZonedDateTime

// A tiny runner, so these tests need nothing but kotlinc: `bash modules/taskflow-alarms/test-kotlin.sh`.
var failures = 0
fun check(name: String, ok: Boolean) {
  println((if (ok) "ok   " else "FAIL ") + name)
  if (!ok) failures++
}

fun ms(text: String, zone: String) = ZonedDateTime.of(java.time.LocalDateTime.parse(text), ZoneId.of(zone)).toInstant().toEpochMilli()

fun main() {
  val india = ZoneId.of("Asia/Kolkata")
  val london = ZoneId.of("Europe/London")
  val r = PlannedAlarm(key = "r1", kind = "reminder", local = "2026-11-20T18:30", title = "Pay rent", taskId = "t1", occurrenceDate = "2026-11-20")

  check("a wall-clock alarm goes off at that time in the phone's zone",
    AlarmMath.fireTime(r, india) == ms("2026-11-20T18:30", "Asia/Kolkata"))
  check("after a move to another zone it still goes off at 18:30 there",
    AlarmMath.fireTime(r, london) == ms("2026-11-20T18:30", "Europe/London"))
  check("a task fixed to a zone keeps that zone wherever the phone is",
    AlarmMath.fireTime(r.copy(zone = "Asia/Kolkata"), london) == ms("2026-11-20T18:30", "Asia/Kolkata"))
  check("a fixed instant wins over a wall-clock time", AlarmMath.fireTime(r.copy(at = 42L), india) == 42L)
  check("an unreadable time is skipped, not a crash", AlarmMath.fireTime(r.copy(local = "soon"), india) == null)
  // 29 March 2026: London clocks jump from 01:00 to 02:00.
  check("a time inside a daylight-saving gap moves forward by the gap",
    AlarmMath.fireTime(r.copy(local = "2026-03-29T01:30"), london) == ms("2026-03-29T02:30", "Europe/London"))

  val at = ms("2026-11-20T18:30", "Asia/Kolkata")
  check("not due a minute early", AlarmMath.due(listOf(r), emptySet(), emptySet(), at - 60_000, india).isEmpty())
  check("due on time", AlarmMath.due(listOf(r), emptySet(), emptySet(), at, india).map { it.key } == listOf("r1"))
  check("not shown twice", AlarmMath.due(listOf(r), setOf("r1"), emptySet(), at, india).isEmpty())
  check("not shown once its task was ticked off from a notification",
    AlarmMath.due(listOf(r), emptySet(), setOf("t1|2026-11-20"), at, india).isEmpty())
  check("still shown five hours late (phone was off)",
    AlarmMath.due(listOf(r), emptySet(), emptySet(), at + 5 * 3_600_000, india).size == 1)
  check("forgotten seven hours late",
    AlarmMath.due(listOf(r), emptySet(), emptySet(), at + 7 * 3_600_000, india).isEmpty() &&
      AlarmMath.expired(listOf(r), emptySet(), at + 7 * 3_600_000, india).size == 1)

  val later = r.copy(key = "r2", local = "2026-11-21T09:00", occurrenceDate = "2026-11-21")
  check("next is the earliest alarm still to come",
    AlarmMath.next(listOf(later, r), emptySet(), emptySet(), at - 1, india) == at)
  check("next skips one already shown",
    AlarmMath.next(listOf(later, r), setOf("r1"), emptySet(), at - 1, india) == ms("2026-11-21T09:00", "Asia/Kolkata"))
  check("nothing next when everything is past", AlarmMath.next(listOf(r), emptySet(), emptySet(), at + 1, india) == null)

  val morning = PlannedAlarm(
    key = "m", kind = "morning", local = "2026-11-20T08:00", title = "{n} tasks for today", titleOne = "1 task for today",
    items = listOf(
      SummaryItem("a", null, "Renew passport"), SummaryItem("b", "2026-11-20", "Water the plants"),
      SummaryItem("c", null, "Call the bank"), SummaryItem("d", null, "Pay rent"), SummaryItem("e", null, "Read"),
    ),
  )
  val full = AlarmMath.text(morning, emptySet())
  check("a summary counts its tasks and lists the first four",
    full?.title == "5 tasks for today" && full.body == "Renew passport, Water the plants, Call the bank, Pay rent and 1 more")
  val one = AlarmMath.text(morning, setOf("a|", "b|2026-11-20", "c|", "d|"))
  check("tasks ticked off from notifications drop out of the summary", one?.title == "1 task for today" && one.body == "Read")
  check("a summary with nothing left is not shown", AlarmMath.text(morning, setOf("a|", "b|2026-11-20", "c|", "d|", "e|")) == null)
  check("a reminder's words are shown as planned", AlarmMath.text(r.copy(body = "Due at 18:30"), emptySet())?.body == "Due at 18:30")

  println(if (failures == 0) "All alarm rules passed." else "$failures failed.")
  if (failures > 0) kotlin.system.exitProcess(1)
}
