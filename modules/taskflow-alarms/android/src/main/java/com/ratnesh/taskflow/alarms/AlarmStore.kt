package com.ratnesh.taskflow.alarms

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Everything the runtime remembers, in the app's private preferences, so it
 * works with the app closed and after a restart:
 *
 *   plan      the alarms the app planned (next 30 days)
 *   snoozes   one-off alarms made by Snooze and by the test button
 *   fired     keys already shown (or forgotten), so nothing shows twice
 *   done      tasks ticked off from a notification, until the app has seen them
 *   actions   taps waiting for the app to save and sync
 */
class AlarmStore(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences("taskflow_alarms", Context.MODE_PRIVATE)

  var plan: List<PlannedAlarm>
    get() = PlanJson.parseAlarms(prefs.getString("plan", "[]") ?: "[]")
    set(value) = prefs.edit().putString("plan", PlanJson.alarmsToJson(value).toString()).apply()

  var snoozes: List<PlannedAlarm>
    get() = PlanJson.parseAlarms(prefs.getString("snoozes", "[]") ?: "[]")
    set(value) = prefs.edit().putString("snoozes", PlanJson.alarmsToJson(value).toString()).apply()

  var fired: Set<String>
    get() = prefs.getStringSet("fired", emptySet())?.toSet() ?: emptySet()
    set(value) = prefs.edit().putStringSet("fired", value).apply()

  /** Done keys and when each was recorded (ms). */
  var done: Map<String, Long>
    get() {
      val o = JSONObject(prefs.getString("done", "{}") ?: "{}")
      return o.keys().asSequence().associateWith { o.optLong(it) }
    }
    set(value) = prefs.edit().putString("done", JSONObject(value as Map<*, *>).toString()).apply()

  fun addDone(key: String, at: Long) {
    done = done + (key to at)
  }

  fun queueAction(action: JSONObject) {
    val list = JSONArray(prefs.getString("actions", "[]") ?: "[]")
    list.put(action)
    prefs.edit().putString("actions", list.toString()).commit()
  }

  /** The waiting taps as a JSON array, removed from the store. */
  @Synchronized
  fun takeActions(): String {
    val list = prefs.getString("actions", "[]") ?: "[]"
    prefs.edit().putString("actions", "[]").commit()
    return list
  }
}

/** The plan travels from the app as JSON; snoozes are kept the same way. */
object PlanJson {
  fun parseAlarms(text: String): List<PlannedAlarm> {
    val arr = try {
      JSONArray(text)
    } catch (e: Exception) {
      return emptyList()
    }
    return (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let { parseAlarm(it) } }
  }

  private fun JSONObject.str(name: String): String? = if (has(name) && !isNull(name)) optString(name) else null

  fun parseAlarm(o: JSONObject): PlannedAlarm? {
    val key = o.str("key") ?: return null
    val items = o.optJSONArray("items")?.let { arr ->
      (0 until arr.length()).mapNotNull { i ->
        arr.optJSONObject(i)?.let { SummaryItem(it.optString("taskId"), it.str("occurrenceDate"), it.optString("title")) }
      }
    } ?: emptyList()
    return PlannedAlarm(
      key = key,
      kind = o.str("kind") ?: "reminder",
      local = o.str("local"),
      zone = o.str("zone"),
      at = if (o.has("at") && !o.isNull("at")) o.optLong("at") else null,
      channel = o.str("channel") ?: "reminders",
      title = o.str("title") ?: "",
      body = o.str("body") ?: "",
      titleOne = o.str("titleOne"),
      taskId = o.str("taskId"),
      occurrenceDate = o.str("occurrenceDate"),
      reminderId = o.str("reminderId"),
      actions = o.optBoolean("actions", false),
      items = items,
      link = o.str("link"),
    )
  }

  fun alarmToJson(a: PlannedAlarm): JSONObject = JSONObject().apply {
    put("key", a.key)
    put("kind", a.kind)
    a.local?.let { put("local", it) }
    a.zone?.let { put("zone", it) }
    a.at?.let { put("at", it) }
    put("channel", a.channel)
    put("title", a.title)
    put("body", a.body)
    a.titleOne?.let { put("titleOne", it) }
    a.taskId?.let { put("taskId", it) }
    a.occurrenceDate?.let { put("occurrenceDate", it) }
    a.reminderId?.let { put("reminderId", it) }
    put("actions", a.actions)
    a.link?.let { put("link", it) }
    if (a.items.isNotEmpty()) {
      put("items", JSONArray().apply {
        a.items.forEach { put(JSONObject().put("taskId", it.taskId).put("occurrenceDate", it.occurrenceDate ?: JSONObject.NULL).put("title", it.title)) }
      })
    }
  }

  fun alarmsToJson(list: List<PlannedAlarm>): JSONArray = JSONArray().apply { list.forEach { put(alarmToJson(it)) } }
}
