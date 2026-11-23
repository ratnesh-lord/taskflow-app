package com.ratnesh.taskflow.google

import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Access to Google APIs on Android, through Google Play services'
 * AuthorizationClient. Google shows its own account picker and consent
 * screen; afterwards an access token (valid for an hour) comes back without
 * asking again, until the person removes TaskFlow's access. No refresh token
 * exists on the phone, and nothing is sent to a server.
 *
 * Google matches the request to the Android OAuth client registered in the
 * person's Google Cloud project by package name and signing certificate
 * (docs/SETUP.md, Google integrations).
 */
class TaskflowGoogleModule : Module() {
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("TaskflowGoogle")

    /**
     * An access token for [scopes], or null when the person has not granted
     * them yet and [interactive] is false, or cancelled the consent screen.
     */
    AsyncFunction("authorize") { scopes: List<String>, interactive: Boolean, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "TaskFlow is not ready yet.", null)
        return@AsyncFunction
      }
      val request = AuthorizationRequest.builder().setRequestedScopes(scopes.map { Scope(it) }).build()
      Identity.getAuthorizationClient(context).authorize(request)
        .addOnSuccessListener { result ->
          if (!result.hasResolution()) {
            promise.resolve(toMap(result))
            return@addOnSuccessListener
          }
          val activity = appContext.currentActivity
          val intent = result.pendingIntent
          if (!interactive || activity == null || intent == null) {
            promise.resolve(null)
            return@addOnSuccessListener
          }
          pending?.resolve(null)
          pending = promise
          try {
            activity.startIntentSenderForResult(intent.intentSender, REQUEST_CODE, null, 0, 0, 0)
          } catch (e: Exception) {
            pending = null
            promise.reject("START_FAILED", e.message ?: "Could not open Google's sign-in screen.", e)
          }
        }
        .addOnFailureListener { e -> promise.reject("AUTH_FAILED", e.message ?: "Google refused the request.", e) }
    }

    OnActivityResult { activity, payload ->
      if (payload.requestCode != REQUEST_CODE) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      try {
        val result = Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(payload.data)
        promise.resolve(toMap(result))
      } catch (e: ApiException) {
        if (e.statusCode == CommonStatusCodes.CANCELED) promise.resolve(null)
        else promise.reject("AUTH_FAILED", e.message ?: "Google refused the request.", e)
      }
    }

    /** Forget a token Google rejected, so the next request gets a fresh one. */
    AsyncFunction("clearToken") { token: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      Identity.getAuthorizationClient(context)
        .clearToken(ClearTokenRequest.builder().setToken(token).build())
        .addOnCompleteListener { promise.resolve(null) }
    }
  }

  private fun toMap(result: AuthorizationResult): Map<String, Any?> = mapOf(
    "accessToken" to result.accessToken,
    "grantedScopes" to result.grantedScopes,
  )

  companion object {
    private const val REQUEST_CODE = 7301
  }
}
