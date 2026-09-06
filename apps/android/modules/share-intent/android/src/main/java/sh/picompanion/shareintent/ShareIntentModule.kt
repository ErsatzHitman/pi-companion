package sh.picompanion.shareintent

import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Native half of `ShareIntentPort` (T36F, plan.md §9.3). See
 * `../../../../../../../../src/features/share/share-intent-receiver.ts`'s
 * doc comment for the route decision this module implements (route 3:
 * a small in-repo native module, not `expo-share-intent`, not
 * `expo-linking`) and
 * `../../../../../../../../src/features/share/share-intent-native-port.ts`
 * for the JS side that consumes this module's two entry points.
 *
 * ## What this module hands to JS, and what it deliberately does not
 *
 * `getInitialShareIntent()` and the `onShareIntent` event both hand JS
 * a plain map shaped exactly like `RawShareIntent`
 * (`share-intent-model.ts`) — never the raw Android `Intent`, and never
 * a byte. A shared file's `content://` URI is an opaque *handle*, not
 * file content; this module resolves only its display name, MIME type,
 * and size (via `ContentResolver` metadata columns) — it never opens
 * the stream. Per this task's brief ("a shared file's name, path and
 * bytes never reach a log, plain storage, or a URL query string"),
 * **this file contains no `Log.d`/`Log.e`/`Log.w` call that carries a
 * name, path, or byte** — it does not log at all, the simplest way to
 * hold that line with zero risk of a future edit adding one back.
 *
 * ## Cold start vs. warm delivery vs. "arrived before JS is listening"
 *
 * - **Cold start** (app launched *by* the share): `getIntent()` on the
 *   hosting activity already *is* the share intent — Android delivered
 *   it as part of process creation, so there is no window where it
 *   could be "dropped for a dead process": a dead process cannot
 *   receive anything; the OS starts a new one with the intent attached.
 *   `getInitialShareIntent()` reads it once (`initialIntentConsumed`
 *   guards against re-delivering it on a later call, matching
 *   `ShareIntentPort.getInitialShareIntent()`'s documented
 *   `Linking.getInitialURL()`-shaped one-shot contract).
 * - **Warm delivery** (app already running, `singleTask` launch mode —
 *   see `apps/android/plugins/with-share-intent-module.ts`'s doc
 *   comment for why `onNewIntent`/`setIntent` must be wired in
 *   `MainActivity`): delivered through `OnNewIntent` below.
 * - **Arrived warm but before any JS listener is attached** (a real,
 *   narrow race: this module can be constructed and receive
 *   `OnNewIntent` before JS has evaluated far enough to call
 *   `ShareIntentPort.subscribe()`): `isObserving` tracks whether a JS
 *   listener is currently attached (set by the `OnStartObserving`/
 *   `OnStopObserving` lifecycle hooks below, which Expo's module system
 *   calls exactly when the JS side's `EventEmitter` listener count for
 *   `onShareIntent` transitions to/from zero). When `OnNewIntent` fires
 *   with no listener attached, the payload is held in `queuedIntent`
 *   (last-one-wins, matching `share-session-chooser.ts`'s own
 *   documented "queued slot" naming) instead of being dropped, and
 *   replayed the moment `OnStartObserving` fires.
 */
class ShareIntentModule : Module() {
  private var initialIntentConsumed = false
  private var isObserving = false
  private var queuedIntent: Map<String, Any?>? = null

  override fun definition() = ModuleDefinition {
    Name("ShareIntentModule")

    Events(EVENT_NAME)

    AsyncFunction("getInitialShareIntent") {
      if (initialIntentConsumed) return@AsyncFunction null
      initialIntentConsumed = true
      val intent = appContext.currentActivity?.intent ?: return@AsyncFunction null
      toRawShareIntentMap(intent)
    }

    OnNewIntent { intent ->
      val payload = toRawShareIntentMap(intent) ?: return@OnNewIntent
      if (isObserving) {
        sendEvent(EVENT_NAME, payload)
      } else {
        queuedIntent = payload
      }
    }

    OnStartObserving(EVENT_NAME) {
      isObserving = true
      queuedIntent?.let { pending ->
        queuedIntent = null
        sendEvent(EVENT_NAME, pending)
      }
    }

    OnStopObserving(EVENT_NAME) {
      isObserving = false
    }
  }

  /**
   * Maps a real Android `Intent` onto `RawShareIntent`'s JS shape.
   * Returns `null` for an intent that is not a share at all (any
   * action other than `SEND`/`SEND_MULTIPLE`) — `classifyShareIntent`
   * only ever needs to see intents that are at least *attempting* to
   * share something; a normal launch intent is not one of them.
   */
  private fun toRawShareIntentMap(intent: Intent): Map<String, Any?>? {
    val action = when (intent.action) {
      Intent.ACTION_SEND -> "SEND"
      Intent.ACTION_SEND_MULTIPLE -> "SEND_MULTIPLE"
      else -> return null
    }

    val mimeType = intent.type ?: ""
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)
    val streamUri = readStreamExtra(intent)

    return mapOf(
      "action" to action,
      "mimeType" to mimeType,
      "text" to text,
      "file" to streamUri?.let { uri -> describeStreamFile(uri, mimeType) },
    )
  }

  @Suppress("DEPRECATION")
  private fun readStreamExtra(intent: Intent): Uri? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }
  }

  /**
   * Resolves a shared file's display name, MIME type, and size from
   * `ContentResolver` *metadata* columns only — never opens
   * `openInputStream(uri)`. `uri.toString()` is the opaque handle
   * `RawShareIntentFile.uri` already documents as never read/logged
   * here; it is handed to JS as data, not written anywhere by this
   * module.
   */
  private fun describeStreamFile(uri: Uri, fallbackMimeType: String): Map<String, Any?> {
    val resolver = appContext.reactContext?.contentResolver
    var name = ""
    var sizeBytes = 0L

    val cursor: Cursor? = resolver?.query(uri, null, null, null, null)
    cursor?.use {
      if (it.moveToFirst()) {
        val nameIndex = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (nameIndex >= 0) name = it.getString(nameIndex) ?: ""
        val sizeIndex = it.getColumnIndex(OpenableColumns.SIZE)
        if (sizeIndex >= 0 && !it.isNull(sizeIndex)) sizeBytes = it.getLong(sizeIndex)
      }
    }

    val resolvedMimeType = resolver?.getType(uri) ?: fallbackMimeType

    return mapOf(
      "name" to name,
      "mimeType" to resolvedMimeType,
      "sizeBytes" to sizeBytes,
      "uri" to uri.toString(),
    )
  }

  companion object {
    private const val EVENT_NAME = "onShareIntent"
  }
}
