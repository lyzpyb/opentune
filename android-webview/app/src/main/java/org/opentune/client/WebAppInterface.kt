package org.opentune.client

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import androidx.core.content.ContextCompat

data class TrackSnapshot(
    val title: String,
    val artist: String,
    val artworkUrl: String,
    val isPlaying: Boolean,
    val currentTimeSec: Double,
    val durationSec: Double
)

class WebAppInterface(
    private val context: Context,
    private val onStateUpdate: (TrackSnapshot) -> Unit
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onPlaybackStateChanged(
        title: String,
        artist: String,
        artworkUrl: String,
        isPlaying: Boolean,
        currentTimeSec: Double,
        durationSec: Double
    ) {
        val safePos = if (currentTimeSec.isFinite() && currentTimeSec >= 0) currentTimeSec else 0.0
        val safeDur = if (durationSec.isFinite() && durationSec >= 0) durationSec else 0.0
        val snapshot = TrackSnapshot(
            title = title.ifBlank { "未在播放" },
            artist = artist.ifBlank { "YouTube Music" },
            artworkUrl = artworkUrl.trim(),
            isPlaying = isPlaying,
            currentTimeSec = safePos,
            durationSec = safeDur
        )

        val serviceIntent = Intent(context, MediaPlaybackService::class.java).apply {
            action = MediaPlaybackService.ACTION_UPDATE_STATE
            putExtra(MediaPlaybackService.EXTRA_TITLE, snapshot.title)
            putExtra(MediaPlaybackService.EXTRA_ARTIST, snapshot.artist)
            putExtra(MediaPlaybackService.EXTRA_ARTWORK_URL, snapshot.artworkUrl)
            putExtra(MediaPlaybackService.EXTRA_PLAYING, snapshot.isPlaying)
            putExtra(MediaPlaybackService.EXTRA_POSITION_MS, (snapshot.currentTimeSec * 1000.0).toLong())
            putExtra(MediaPlaybackService.EXTRA_DURATION_MS, (snapshot.durationSec * 1000.0).toLong())
        }
        ContextCompat.startForegroundService(context, serviceIntent)

        mainHandler.post {
            onStateUpdate(snapshot)
        }
    }
}
