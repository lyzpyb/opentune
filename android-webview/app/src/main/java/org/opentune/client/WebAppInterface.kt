package org.opentune.client

import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import androidx.core.content.ContextCompat

class WebAppInterface(private val context: Context) {

    @JavascriptInterface
    fun onPlaybackStateChanged(title: String, artist: String, isPlaying: Boolean) {
        val serviceIntent = Intent(context, MediaPlaybackService::class.java).apply {
            action = MediaPlaybackService.ACTION_UPDATE_STATE
            putExtra(MediaPlaybackService.EXTRA_TITLE, title)
            putExtra(MediaPlaybackService.EXTRA_ARTIST, artist)
            putExtra(MediaPlaybackService.EXTRA_PLAYING, isPlaying)
        }
        ContextCompat.startForegroundService(context, serviceIntent)
    }
}
