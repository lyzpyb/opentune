package org.opentune.client

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MediaPlaybackService : Service() {

    companion object {
        const val CHANNEL_ID = "ytm_native_playback"
        const val NOTIFICATION_ID = 7001
        const val ACTION_UPDATE_STATE = "org.opentune.client.UPDATE_STATE"
        const val ACTION_MEDIA_COMMAND = "org.opentune.client.MEDIA_COMMAND"
        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_ARTWORK_URL = "artwork_url"
        const val EXTRA_PLAYING = "playing"
        const val EXTRA_POSITION_MS = "position_ms"
        const val EXTRA_DURATION_MS = "duration_ms"
        const val EXTRA_COMMAND = "command"
        const val EXTRA_SEEK_SEC = "seek_sec"
    }

    private lateinit var mediaSession: MediaSessionCompat
    private lateinit var audioManager: AudioManager
    private var audioFocusRequest: AudioFocusRequest? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val artworkExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var currentTitle = "OpenTune"
    private var currentArtist = "YouTube Music"
    private var currentArtworkUrl = ""
    private var currentArtworkBitmap: Bitmap? = null
    private var isPlaying = false
    private var currentPositionMs = 0L
    private var currentDurationMs = 0L

    private val becomingNoisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY && isPlaying) {
                broadcastCommand("pause")
            }
        }
    }

    private val audioFocusListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (isPlaying) {
                    broadcastCommand("pause")
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager

        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attrs)
            .setAcceptsDelayedFocusGain(false)
            .setOnAudioFocusChangeListener(audioFocusListener)
            .build()

        mediaSession = MediaSessionCompat(this, "YtmNativeMediaSession").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = broadcastCommand("play")
                override fun onPause() = broadcastCommand("pause")
                override fun onSkipToNext() = broadcastCommand("next")
                override fun onSkipToPrevious() = broadcastCommand("previous")
                override fun onSeekTo(pos: Long) = broadcastSeek(pos.coerceAtLeast(0L) / 1000.0)
            })
            isActive = true
        }

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "org.opentune.client:AudioWakeLock")

        ContextCompat.registerReceiver(
            this,
            becomingNoisyReceiver,
            IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE_STATE -> {
                val prevPlaying = isPlaying
                currentTitle = intent.getStringExtra(EXTRA_TITLE) ?: currentTitle
                currentArtist = intent.getStringExtra(EXTRA_ARTIST) ?: currentArtist
                isPlaying = intent.getBooleanExtra(EXTRA_PLAYING, false)
                currentPositionMs = intent.getLongExtra(EXTRA_POSITION_MS, currentPositionMs)
                currentDurationMs = intent.getLongExtra(EXTRA_DURATION_MS, currentDurationMs)

                val newArtUrl = intent.getStringExtra(EXTRA_ARTWORK_URL).orEmpty()
                if (newArtUrl != currentArtworkUrl) {
                    currentArtworkUrl = newArtUrl
                    if (newArtUrl.isBlank()) {
                        currentArtworkBitmap = null
                    } else {
                        loadArtworkAsync(newArtUrl)
                    }
                }

                if (isPlaying && !prevPlaying) {
                    audioFocusRequest?.let { audioManager.requestAudioFocus(it) }
                } else if (!isPlaying && prevPlaying) {
                    audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
                }

                updateWakeLock(isPlaying)
                updateMediaSessionAndNotification()
            }
            "CMD_PLAY" -> broadcastCommand("play")
            "CMD_PAUSE" -> broadcastCommand("pause")
            "CMD_TOGGLE" -> broadcastCommand("toggle")
            "CMD_NEXT" -> broadcastCommand("next")
            "CMD_PREV" -> broadcastCommand("previous")
        }
        return START_STICKY
    }

    private fun loadArtworkAsync(url: String) {
        artworkExecutor.execute {
            val bitmap = try {
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 5000
                    readTimeout = 5000
                    doInput = true
                }
                try {
                    if (conn.responseCode in 200..299) {
                        conn.inputStream.use { BitmapFactory.decodeStream(it) }
                    } else null
                } finally {
                    conn.disconnect()
                }
            } catch (_: Exception) {
                null
            }
            mainHandler.post {
                if (url == currentArtworkUrl && bitmap != null) {
                    currentArtworkBitmap = bitmap
                    updateMediaSessionAndNotification()
                }
            }
        }
    }

    private fun updateWakeLock(playing: Boolean) {
        val lock = wakeLock ?: return
        if (playing && !lock.isHeld) {
            lock.acquire(6 * 60 * 60 * 1000L)
        } else if (!playing && lock.isHeld) {
            lock.release()
        }
    }

    private fun broadcastCommand(command: String) {
        val intent = Intent(ACTION_MEDIA_COMMAND).apply {
            setPackage(packageName)
            putExtra(EXTRA_COMMAND, command)
        }
        sendBroadcast(intent)
    }

    private fun broadcastSeek(seekSec: Double) {
        val intent = Intent(ACTION_MEDIA_COMMAND).apply {
            setPackage(packageName)
            putExtra(EXTRA_COMMAND, "seek")
            putExtra(EXTRA_SEEK_SEC, seekSec)
        }
        sendBroadcast(intent)
    }

    private fun updateMediaSessionAndNotification() {
        val playbackState = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                    PlaybackStateCompat.ACTION_SEEK_TO
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                currentPositionMs,
                if (isPlaying) 1.0f else 0.0f
            )
            .build()

        mediaSession.setPlaybackState(playbackState)

        val metaBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)
        currentArtworkBitmap?.let { bmp ->
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bmp)
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, bmp)
        }
        mediaSession.setMetadata(metaBuilder.build())

        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val prevIntent = serviceActionPendingIntent("CMD_PREV", 1)
        val playPauseIntent = serviceActionPendingIntent(if (isPlaying) "CMD_PAUSE" else "CMD_PLAY", 2)
        val nextIntent = serviceActionPendingIntent("CMD_NEXT", 3)

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setLargeIcon(currentArtworkBitmap)
            .setContentIntent(openAppIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .addAction(android.R.drawable.ic_media_previous, "上一首", prevIntent)
            .addAction(
                if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (isPlaying) "暂停" else "播放",
                playPauseIntent
            )
            .addAction(android.R.drawable.ic_media_next, "下一首", nextIntent)
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
        return builder.build()
    }

    private fun serviceActionPendingIntent(actionName: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, MediaPlaybackService::class.java).apply { action = actionName }
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "音乐后台播放控制",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(becomingNoisyReceiver)
        } catch (_: Exception) {}
        audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        wakeLock?.takeIf { it.isHeld }?.release()
        artworkExecutor.shutdownNow()
        mediaSession.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
