package com.ratnesh.taskflow.alarms

/**
 * The app's design tokens for the widgets: a copy of `palette` and `widget`
 * in src/ui/tokens.ts, which stays the source. src/ui/widget-tokens.test.ts
 * fails when the two differ.
 */
data class WidgetPalette(
  val background: Int,
  val text: Int,
  val textSecondary: Int,
  val divider: Int,
  val accent: Int,
  val onAccent: Int,
  val overdue: Int,
  val completed: Int,
)

object WidgetTokens {
  val light = WidgetPalette(
    background = 0xFFFFFFFF.toInt(),
    text = 0xFF111111.toInt(),
    textSecondary = 0xFF777777.toInt(),
    divider = 0xFFE5E5E5.toInt(),
    accent = 0xFF2563EB.toInt(),
    onAccent = 0xFFFFFFFF.toInt(),
    overdue = 0xFFDC2626.toInt(),
    completed = 0xFF16A34A.toInt(),
  )

  val dark = WidgetPalette(
    background = 0xFF101010.toInt(),
    text = 0xFFF5F5F5.toInt(),
    textSecondary = 0xFF999999.toInt(),
    divider = 0xFF292929.toInt(),
    accent = 0xFF60A5FA.toInt(),
    onAccent = 0xFF101010.toInt(),
    overdue = 0xFFF87171.toInt(),
    completed = 0xFF4ADE80.toInt(),
  )

  // Text sizes (sp) and row height (dp).
  const val LABEL = 11f
  const val CAPTION = 12f
  const val ROW = 13f
  const val HEADING = 15f
  const val TIME = 20f
  const val NUMBER = 40f
  const val ROW_HEIGHT = 44
}
