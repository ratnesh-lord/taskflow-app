package com.ratnesh.taskflow.alarms

import android.content.Context
import org.json.JSONObject

/**
 * What the widgets draw from, in the app's private preferences:
 *
 *   data    the app's latest widget data (src/core/widgets.ts), or a
 *           signed-out marker; nothing until the app first sends it
 *   theme   light | dark | system, the app's Appearance setting
 *
 * Rows ticked off on a widget are not kept here: they go into the alarm
 * runtime's done list (AlarmStore), which notifications use too.
 */
class WidgetStore(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences("taskflow_widgets", Context.MODE_PRIVATE)

  /** Saved as sent; read with [read]. */
  var raw: String?
    get() = prefs.getString("data", null)
    set(value) {
      prefs.edit().putString("data", value).commit()
    }

  var theme: String
    get() = prefs.getString("theme", "system") ?: "system"
    set(value) {
      prefs.edit().putString("theme", value).apply()
    }

  sealed interface State {
    /** The app has not sent anything yet (never opened since install). */
    object Empty : State
    object SignedOut : State
    data class Ready(val data: WidgetData) : State
  }

  fun read(): State = parse(raw)

  companion object {
    fun parse(text: String?): State {
      if (text == null) return State.Empty
      val o = runCatching { JSONObject(text) }.getOrNull() ?: return State.Empty
      if (!o.optBoolean("signedIn", false)) return State.SignedOut
      val days = o.optJSONArray("days") ?: return State.Empty
      return State.Ready(
        WidgetData(
          generatedAt = o.optLong("generatedAt"),
          hour12 = o.optBoolean("hour12", false),
          days = (0 until days.length()).mapNotNull { i -> days.optJSONObject(i)?.let(::parseDay) },
        ),
      )
    }

    private val HEX = Regex("^#[0-9A-Fa-f]{6}$")

    private fun parsePair(o: JSONObject): ColorPair? {
      val light = o.optString("light")
      val dark = o.optString("dark")
      return if (HEX.matches(light) && HEX.matches(dark)) ColorPair(light, dark) else null
    }

    private fun JSONObject.str(name: String): String? = if (has(name) && !isNull(name)) optString(name) else null

    private fun parseDay(o: JSONObject): WidgetDay {
      val rows = o.optJSONArray("rows")
      val week = o.optJSONArray("week")
      return WidgetDay(
        date = o.optString("date"),
        heading = o.optString("heading"),
        rows = if (rows == null) emptyList() else (0 until rows.length()).mapNotNull { i ->
          rows.optJSONObject(i)?.let { r ->
            WidgetRow(
              taskId = r.optString("taskId"),
              occurrenceDate = r.str("occurrenceDate"),
              title = r.optString("title"),
              label = r.optString("label"),
              due = r.optString("due"),
              priority = r.optString("priority", "medium"),
              earlier = r.optBoolean("earlier", false),
              color = r.optJSONObject("color")?.let(::parsePair),
              priorityColor = r.optJSONObject("priorityColor")?.let(::parsePair),
            )
          }
        },
        pending = o.optInt("pending"),
        overdue = o.optInt("overdue"),
        done = o.optInt("done"),
        important = o.optInt("important"),
        week = if (week == null) List(7) { 0 } else List(7) { i -> week.optInt(i, 0) },
      )
    }
  }
}
