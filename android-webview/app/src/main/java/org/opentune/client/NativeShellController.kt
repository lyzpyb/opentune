package org.opentune.client

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class NativeShellController(
    private val activity: Activity,
    private val startUrl: String,
    private val onNavigateUrl: (String) -> Unit,
    private val onPlaybackCommand: (String, Double) -> Unit
) {
    private lateinit var miniProgressBar: ProgressBar
    private lateinit var miniArtworkView: ImageView
    private lateinit var miniTitleView: TextView
    private lateinit var miniArtistView: TextView
    private lateinit var miniPlayBtn: TextView
    private val navTabViews = mutableMapOf<String, TextView>()

    lateinit var lyricsOverlay: LinearLayout
        private set
    private lateinit var lyricsArtworkView: ImageView
    private lateinit var lyricsTitleView: TextView
    private lateinit var lyricsArtistView: TextView
    private lateinit var lyricsBadgeView: TextView
    private lateinit var lyricsScrollView: ScrollView
    private lateinit var lyricsLinesContainer: LinearLayout
    private lateinit var lyricsSeekBar: SeekBar
    private lateinit var lyricsCurTimeView: TextView
    private lateinit var lyricsDurTimeView: TextView
    private lateinit var lyricsPlayBtn: TextView

    private val artworkExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var loadedArtworkUrl = ""
    private var currentTrack = TrackSnapshot("未在播放", "OpenTune", "", false, 0.0, 0.0)
    private var currentLyrics = LyricsResult("", "idle")
    private var renderedLyricsSignature = ""
    private var activeLyricIndex = -1
    private var isUserSeeking = false

    private fun dp(value: Int): Int = (value * activity.resources.displayMetrics.density).toInt()

    private fun roundedBg(colorHex: String, radiusDp: Int, strokeColorHex: String? = null): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(colorHex))
            cornerRadius = dp(radiusDp).toFloat()
            if (strokeColorHex != null) {
                setStroke(dp(1), Color.parseColor(strokeColorHex))
            }
        }
    }

    fun buildMiniPlayerBar(): LinearLayout {
        val wrapper = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#14161D"))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        miniProgressBar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 1000
            progress = 0
            progressDrawable.setTint(Color.parseColor("#FF0033"))
            progressBackgroundTintList = ColorStateList.valueOf(Color.parseColor("#26FFFFFF"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2))
        }
        wrapper.addView(miniProgressBar)

        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(10), dp(8))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64))
        }

        val infoClickArea = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f)
            setOnClickListener { setLyricsOverlayOpen(true) }
        }

        miniArtworkView = ImageView(activity).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = roundedBg("#222531", 8)
            clipToOutline = true
            layoutParams = LinearLayout.LayoutParams(dp(46), dp(46))
        }
        infoClickArea.addView(miniArtworkView)

        val textCol = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), 0, dp(8), 0)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        miniTitleView = TextView(activity).apply {
            text = "未在播放"
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        miniArtistView = TextView(activity).apply {
            text = "OpenTune"
            textSize = 12f
            setTextColor(Color.parseColor("#A1A1AA"))
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        textCol.addView(miniTitleView)
        textCol.addView(miniArtistView)
        infoClickArea.addView(textCol)
        row.addView(infoClickArea)

        val makeMiniAction: (String, Int, () -> Unit) -> TextView = { label, sizeSp, onClick ->
            TextView(activity).apply {
                text = label
                textSize = sizeSp.toFloat()
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                background = roundedBg("#18FFFFFF", 18)
                layoutParams = LinearLayout.LayoutParams(dp(38), dp(38)).apply { marginStart = dp(6) }
                setOnClickListener { onClick() }
            }
        }

        val lyricsBtn = makeMiniAction("词", 13) { setLyricsOverlayOpen(true) }
        miniPlayBtn = makeMiniAction("▶", 15) {
            onPlaybackCommand(if (currentTrack.isPlaying) "pause" else "play", -1.0)
        }.apply {
            background = roundedBg("#FF0033", 19)
        }
        val nextBtn = makeMiniAction("⏭", 14) { onPlaybackCommand("next", -1.0) }

        row.addView(lyricsBtn)
        row.addView(miniPlayBtn)
        row.addView(nextBtn)
        wrapper.addView(row)
        return wrapper
    }

    fun buildBottomNavBar(): LinearLayout {
        val bar = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#0C0D12"))
            setPadding(dp(8), dp(6), dp(8), dp(6))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54))
        }
        val tabs = listOf(
            Triple("home", "首页", startUrl),
            Triple("explore", "探索", "$startUrl/explore"),
            Triple("library", "媒体库", "$startUrl/library/playlists"),
            Triple("liked", "喜欢", "$startUrl/playlist?list=LM")
        )
        for ((id, label, targetUrl) in tabs) {
            val tab = TextView(activity).apply {
                text = label
                textSize = 13f
                gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).apply {
                    marginStart = dp(4)
                    marginEnd = dp(4)
                }
                setOnClickListener {
                    setLyricsOverlayOpen(false)
                    updateActiveNavTab(id)
                    onNavigateUrl(targetUrl)
                }
            }
            navTabViews[id] = tab
            bar.addView(tab)
        }
        updateActiveNavTab("home")
        return bar
    }

    fun buildImmersiveLyricsOverlay(): LinearLayout {
        lyricsOverlay = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B0C11"))
            visibility = View.GONE
            isClickable = true
            isFocusable = true
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(14), dp(16), dp(10))
        }
        val headerTitle = TextView(activity).apply {
            text = "正在播放 · 实时歌词"
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#A1A1AA"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val closeBtn = TextView(activity).apply {
            text = "收起"
            textSize = 13f
            setTextColor(Color.WHITE)
            background = roundedBg("#1FFFFFFF", 8)
            setPadding(dp(14), dp(6), dp(14), dp(6))
            setOnClickListener { setLyricsOverlayOpen(false) }
        }
        header.addView(headerTitle)
        header.addView(closeBtn)
        lyricsOverlay.addView(header)

        val trackCard = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(8), dp(18), dp(14))
        }
        lyricsArtworkView = ImageView(activity).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = roundedBg("#1E202B", 12)
            clipToOutline = true
            layoutParams = LinearLayout.LayoutParams(dp(68), dp(68))
        }
        trackCard.addView(lyricsArtworkView)

        val metaCol = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        lyricsTitleView = TextView(activity).apply {
            text = "未在播放"
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.WHITE)
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
        }
        lyricsArtistView = TextView(activity).apply {
            text = "OpenTune"
            textSize = 13f
            setTextColor(Color.parseColor("#A1A1AA"))
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(0, dp(3), 0, dp(6))
        }
        lyricsBadgeView = TextView(activity).apply {
            text = "等待播放歌曲"
            textSize = 11f
            setTextColor(Color.parseColor("#D4D4D8"))
            background = roundedBg("#1AFFFFFF", 10)
            setPadding(dp(8), dp(3), dp(8), dp(3))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        metaCol.addView(lyricsTitleView)
        metaCol.addView(lyricsArtistView)
        metaCol.addView(lyricsBadgeView)
        trackCard.addView(metaCol)
        lyricsOverlay.addView(trackCard)

        lyricsScrollView = ScrollView(activity).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            isVerticalScrollBarEnabled = false
        }
        lyricsLinesContainer = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(24), dp(22), dp(80))
        }
        lyricsScrollView.addView(lyricsLinesContainer)
        lyricsOverlay.addView(lyricsScrollView)

        val controlsBox = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#13151C"))
            setPadding(dp(20), dp(12), dp(20), dp(18))
        }
        lyricsSeekBar = SeekBar(activity).apply {
            max = 1000
            progress = 0
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (fromUser && currentTrack.durationSec > 0) {
                        lyricsCurTimeView.text = formatTime(currentTrack.durationSec * (progress / 1000.0))
                    }
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) { isUserSeeking = true }
                override fun onStopTrackingTouch(seekBar: SeekBar?) {
                    isUserSeeking = false
                    val dur = currentTrack.durationSec
                    if (dur > 0 && seekBar != null) {
                        onPlaybackCommand("seek", dur * (seekBar.progress / 1000.0))
                    }
                }
            })
        }
        controlsBox.addView(lyricsSeekBar)

        val timeRow = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(4), dp(2), dp(4), dp(10))
        }
        lyricsCurTimeView = TextView(activity).apply {
            text = "0:00"
            textSize = 11f
            setTextColor(Color.parseColor("#A1A1AA"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        lyricsDurTimeView = TextView(activity).apply {
            text = "0:00"
            textSize = 11f
            setTextColor(Color.parseColor("#A1A1AA"))
            gravity = Gravity.END
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        timeRow.addView(lyricsCurTimeView)
        timeRow.addView(lyricsDurTimeView)
        controlsBox.addView(timeRow)

        val transport = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        val makeCtrl: (String, Int, String, () -> Unit) -> TextView = { label, sizeDp, bgHex, onClick ->
            TextView(activity).apply {
                text = label
                textSize = 18f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                background = roundedBg(bgHex, sizeDp / 2)
                layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp)).apply {
                    marginStart = dp(12)
                    marginEnd = dp(12)
                }
                setOnClickListener { onClick() }
            }
        }
        val prevBtn = makeCtrl("⏮", 46, "#18FFFFFF") { onPlaybackCommand("previous", -1.0) }
        lyricsPlayBtn = makeCtrl("▶", 54, "#FF0033") {
            onPlaybackCommand(if (currentTrack.isPlaying) "pause" else "play", -1.0)
        }
        val nextBtn = makeCtrl("⏭", 46, "#18FFFFFF") { onPlaybackCommand("next", -1.0) }
        transport.addView(prevBtn)
        transport.addView(lyricsPlayBtn)
        transport.addView(nextBtn)
        controlsBox.addView(transport)
        lyricsOverlay.addView(controlsBox)

        return lyricsOverlay
    }

    fun isLyricsOpen(): Boolean = ::lyricsOverlay.isInitialized && lyricsOverlay.visibility == View.VISIBLE

    fun setLyricsOverlayOpen(open: Boolean) {
        if (!::lyricsOverlay.isInitialized) return
        lyricsOverlay.visibility = if (open) View.VISIBLE else View.GONE
        if (open) {
            renderLyricsUi()
            highlightActiveLyric(forceScroll = true)
        }
    }

    fun syncTabFromUrl(rawUrl: String?) {
        val uri = try { Uri.parse(rawUrl.orEmpty()) } catch (_: Exception) { return }
        val path = uri.path.orEmpty()
        val list = uri.getQueryParameter("list")
        val route = when {
            path == "/" || path.isEmpty() -> "home"
            path.startsWith("/explore") -> "explore"
            path.startsWith("/library") -> "library"
            path.startsWith("/playlist") && list == "LM" -> "liked"
            else -> ""
        }
        if (route.isNotEmpty()) updateActiveNavTab(route)
    }

    fun updateActiveNavTab(activeId: String) {
        for ((id, view) in navTabViews) {
            val isActive = id == activeId
            view.setTextColor(if (isActive) Color.WHITE else Color.parseColor("#8E8E93"))
            view.setTypeface(null, if (isActive) Typeface.BOLD else Typeface.NORMAL)
            view.background = if (isActive) roundedBg("#24FF0033", 10) else null
        }
    }

    fun onTrackUpdate(snapshot: TrackSnapshot) {
        val prevKey = LyricsRepository.buildKey(currentTrack.title, currentTrack.artist)
        currentTrack = snapshot

        miniTitleView.text = snapshot.title
        miniArtistView.text = snapshot.artist
        lyricsTitleView.text = snapshot.title
        lyricsArtistView.text = snapshot.artist

        val playGlyph = if (snapshot.isPlaying) "⏸" else "▶"
        miniPlayBtn.text = playGlyph
        lyricsPlayBtn.text = playGlyph

        val pct = if (snapshot.durationSec > 0) {
            ((snapshot.currentTimeSec / snapshot.durationSec) * 1000.0).toInt().coerceIn(0, 1000)
        } else 0
        miniProgressBar.progress = pct
        if (!isUserSeeking) {
            lyricsSeekBar.progress = pct
            lyricsCurTimeView.text = formatTime(snapshot.currentTimeSec)
        }
        lyricsDurTimeView.text = formatTime(snapshot.durationSec)

        if (snapshot.artworkUrl.isNotBlank() && snapshot.artworkUrl != loadedArtworkUrl) {
            loadedArtworkUrl = snapshot.artworkUrl
            loadArtworkThumb(snapshot.artworkUrl)
        }

        val nextKey = LyricsRepository.buildKey(snapshot.title, snapshot.artist)
        if (nextKey != prevKey) {
            LyricsRepository.fetchLyrics(snapshot.title, snapshot.artist, snapshot.durationSec) { res ->
                currentLyrics = res
                renderLyricsUi()
            }
        } else if (isLyricsOpen()) {
            highlightActiveLyric(forceScroll = false)
        }
    }

    private fun loadArtworkThumb(url: String) {
        artworkExecutor.execute {
            val bmp = try {
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
                if (url == loadedArtworkUrl && bmp != null) {
                    miniArtworkView.setImageBitmap(bmp)
                    lyricsArtworkView.setImageBitmap(bmp)
                }
            }
        }
    }

    private fun renderLyricsUi() {
        val sig = "${currentLyrics.key}|${currentLyrics.status}|${currentLyrics.synced.size}|${currentLyrics.plain.length}"
        if (sig == renderedLyricsSignature) return
        renderedLyricsSignature = sig
        activeLyricIndex = -1
        lyricsLinesContainer.removeAllViews()

        when {
            currentLyrics.status == "loading" -> {
                lyricsBadgeView.text = "正在匹配歌词..."
                lyricsLinesContainer.addView(makeEmptyLyricsView("正在从 LRCLIB 获取实时歌词..."))
            }
            currentLyrics.synced.isNotEmpty() -> {
                lyricsBadgeView.text = "时间轴同步歌词 · 点击行跳转"
                currentLyrics.synced.forEachIndexed { idx, line ->
                    val tv = TextView(activity).apply {
                        text = line.text
                        textSize = 18f
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(Color.parseColor("#55FFFFFF"))
                        setPadding(dp(8), dp(10), dp(8), dp(10))
                        tag = idx
                        setOnClickListener { onPlaybackCommand("seek", line.timeSec) }
                    }
                    lyricsLinesContainer.addView(tv)
                }
                highlightActiveLyric(forceScroll = true)
            }
            currentLyrics.plain.isNotBlank() -> {
                lyricsBadgeView.text = "纯文本歌词"
                val tv = TextView(activity).apply {
                    text = currentLyrics.plain
                    textSize = 15f
                    setLineSpacing(dp(6).toFloat(), 1.1f)
                    setTextColor(Color.parseColor("#D4D4D8"))
                }
                lyricsLinesContainer.addView(tv)
            }
            else -> {
                lyricsBadgeView.text = if (currentLyrics.status == "not-found") "未匹配到歌词" else "等待播放歌曲"
                val msg = if (currentLyrics.status == "not-found") {
                    "暂未匹配到这首歌的歌词（可能是纯音乐或曲名包含额外后缀）。"
                } else {
                    "开始播放音乐后，这里会自动加载实时滚动歌词。"
                }
                lyricsLinesContainer.addView(makeEmptyLyricsView(msg))
            }
        }
    }

    private fun makeEmptyLyricsView(msg: String): TextView {
        return TextView(activity).apply {
            text = msg
            textSize = 15f
            setTextColor(Color.parseColor("#8E8E93"))
            setPadding(dp(4), dp(24), dp(4), dp(24))
        }
    }

    private fun highlightActiveLyric(forceScroll: Boolean) {
        val synced = currentLyrics.synced
        if (synced.isEmpty()) return
        val cur = currentTrack.currentTimeSec
        var nextIdx = -1
        for (i in synced.indices) {
            if (cur + 0.25 >= synced[i].timeSec) nextIdx = i else break
        }
        if (nextIdx == activeLyricIndex && !forceScroll) return
        activeLyricIndex = nextIdx

        for (i in 0 until lyricsLinesContainer.childCount) {
            val tv = lyricsLinesContainer.getChildAt(i) as? TextView ?: continue
            val active = i == activeLyricIndex
            tv.setTextColor(if (active) Color.WHITE else Color.parseColor("#55FFFFFF"))
            tv.textSize = if (active) 21f else 17f
        }
        if (activeLyricIndex in 0 until lyricsLinesContainer.childCount) {
            val targetView = lyricsLinesContainer.getChildAt(activeLyricIndex)
            lyricsScrollView.post {
                val targetY = (targetView.top - lyricsScrollView.height / 3).coerceAtLeast(0)
                if (forceScroll) lyricsScrollView.scrollTo(0, targetY)
                else lyricsScrollView.smoothScrollTo(0, targetY)
            }
        }
    }

    private fun formatTime(sec: Double): String {
        val total = sec.toInt().coerceAtLeast(0)
        val m = total / 60
        val s = total % 60
        return "$m:${if (s < 10) "0$s" else "$s"}"
    }

    fun release() {
        artworkExecutor.shutdownNow()
    }
}
