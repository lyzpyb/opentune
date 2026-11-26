package org.opentune.client

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

data class LyricLine(val timeSec: Double, val text: String)

data class LyricsResult(
    val key: String,
    val status: String,
    val synced: List<LyricLine> = emptyList(),
    val plain: String = ""
)

object LyricsRepository {
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val cache = ConcurrentHashMap<String, LyricsResult>()
    private val timestampRegex = Regex("\\[(\\d{1,2}):(\\d{2})(?:\\.(\\d{1,3}))?]")

    fun normalizeArtist(raw: String): String {
        return raw.trim().split(Regex("[•·—|]")).firstOrNull()?.trim().orEmpty()
    }

    fun buildKey(title: String, artist: String): String {
        return "${title.trim()}|${normalizeArtist(artist)}"
    }

    fun fetchLyrics(
        title: String,
        artist: String,
        durationSec: Double,
        onResult: (LyricsResult) -> Unit
    ) {
        val cleanTitle = title.trim()
        val cleanArtist = normalizeArtist(artist)
        if (cleanTitle.isEmpty() || cleanTitle == "YouTube Music" || cleanTitle == "未在播放") {
            mainHandler.post { onResult(LyricsResult("", "idle")) }
            return
        }

        val key = "$cleanTitle|$cleanArtist"
        cache[key]?.let { cached ->
            mainHandler.post { onResult(cached) }
            return
        }

        mainHandler.post { onResult(LyricsResult(key, "loading")) }

        executor.execute {
            val result = try {
                val data = queryGetApi(cleanTitle, cleanArtist, durationSec)
                    ?: querySearchApi(cleanTitle, cleanArtist)
                val synced = parseLrc(data?.optString("syncedLyrics").orEmpty())
                val plain = data?.optString("plainLyrics").orEmpty().trim()
                val status = if (synced.isNotEmpty() || plain.isNotEmpty()) "ready" else "not-found"
                LyricsResult(key, status, synced, plain)
            } catch (_: Exception) {
                LyricsResult(key, "not-found")
            }
            cache[key] = result
            mainHandler.post { onResult(result) }
        }
    }

    private fun queryGetApi(title: String, artist: String, durationSec: Double): JSONObject? {
        val sb = StringBuilder("https://lrclib.net/api/get?track_name=")
        sb.append(URLEncoder.encode(title, "UTF-8"))
        if (artist.isNotEmpty()) {
            sb.append("&artist_name=").append(URLEncoder.encode(artist, "UTF-8"))
        }
        if (durationSec > 1.0) {
            sb.append("&duration=").append(durationSec.toInt())
        }
        val body = httpGet(sb.toString()) ?: return null
        return JSONObject(body)
    }

    private fun querySearchApi(title: String, artist: String): JSONObject? {
        val query = if (artist.isNotEmpty()) "$title $artist" else title
        val url = "https://lrclib.net/api/search?q=${URLEncoder.encode(query, "UTF-8")}"
        val body = httpGet(url) ?: return null
        val arr = JSONArray(body)
        if (arr.length() == 0) return null
        var fallback: JSONObject? = null
        for (i in 0 until arr.length()) {
            val item = arr.optJSONObject(i) ?: continue
            if (fallback == null) fallback = item
            if (!item.optString("syncedLyrics").isNullOrBlank()) {
                return item
            }
        }
        return fallback
    }

    private fun httpGet(rawUrl: String): String? {
        val conn = (URL(rawUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 6000
            readTimeout = 6000
            setRequestProperty("User-Agent", "OpenTune/1.2.0 (https://github.com/lyzpyb/opentune)")
            setRequestProperty("Accept", "application/json")
        }
        return try {
            if (conn.responseCode in 200..299) {
                conn.inputStream.bufferedReader().use { it.readText() }
            } else {
                null
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun parseLrc(lrcText: String): List<LyricLine> {
        if (lrcText.isBlank()) return emptyList()
        val lines = mutableListOf<LyricLine>()
        for (rawLine in lrcText.lineSequence()) {
            val matches = timestampRegex.findAll(rawLine).toList()
            if (matches.isEmpty()) continue
            val text = rawLine.replace(timestampRegex, "").trim()
            if (text.isEmpty()) continue
            for (m in matches) {
                val mins = m.groupValues[1].toIntOrNull() ?: 0
                val secs = m.groupValues[2].toIntOrNull() ?: 0
                val fracStr = m.groupValues[3]
                val frac = if (fracStr.isEmpty()) 0.0 else {
                    (fracStr.toDoubleOrNull() ?: 0.0) / Math.pow(10.0, fracStr.length.toDouble())
                }
                lines.add(LyricLine(mins * 60.0 + secs + frac, text))
            }
        }
        lines.sortBy { it.timeSec }
        return lines
    }
}
