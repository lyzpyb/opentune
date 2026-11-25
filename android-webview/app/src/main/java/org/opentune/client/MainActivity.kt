package org.opentune.client

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var floatingNavBar: LinearLayout
    private lateinit var cookieFallbackButton: Button
    private val startUrl = "https://music.youtube.com"
    private val sanitizeUa = true

    // Firefox Android UA bypasses Chromium/WebView attestation checks on accounts.google.com
    private val firefoxAndroidUa =
        "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0"
    private val chromeAndroidUa =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.107 Mobile Safari/537.36"

    private val mediaControlReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val command = intent?.getStringExtra(MediaPlaybackService.EXTRA_COMMAND) ?: return
            dispatchJsPlaybackCommand(command)
        }
    }

    private fun isGoogleAuthHost(host: String): Boolean {
        val h = host.lowercase()
        return h == "accounts.google.com" ||
            h == "accounts.youtube.com" ||
            h == "gds.google.com" ||
            h == "myaccount.google.com" ||
            h == "consent.youtube.com" ||
            h == "consent.google.com"
    }

    private fun isAllowedInAppHost(host: String): Boolean {
        val h = host.lowercase()
        return h == "music.youtube.com" || isGoogleAuthHost(h)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestNotificationPermissionIfNeeded()

        val root = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#030303"))
        }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#030303"))
        }
        root.addView(webView)

        // Floating Back / Home bar shown automatically whenever outside music.youtube.com
        floatingNavBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#E6121318"))
            setPadding(16, 10, 16, 10)
            visibility = View.GONE
        }

        val backBtn = Button(this).apply {
            text = "← 返回"
            textSize = 12f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#33FFFFFF"))
            setPadding(24, 8, 24, 8)
            setOnClickListener {
                if (webView.canGoBack()) webView.goBack() else loadMusicHome()
            }
        }
        val homeBtn = Button(this).apply {
            text = "⌂ 音乐首页"
            textSize = 12f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#FF0033"))
            setPadding(24, 8, 24, 8)
            setOnClickListener { loadMusicHome() }
        }
        cookieFallbackButton = Button(this).apply {
            text = "粘贴 Cookie"
            textSize = 12f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#33FFFFFF"))
            setPadding(24, 8, 24, 8)
            visibility = View.GONE
            setOnClickListener { showCookieImportDialog() }
        }

        val spacer = {
            View(this).apply {
                layoutParams = LinearLayout.LayoutParams(12, 1)
            }
        }
        floatingNavBar.addView(backBtn)
        floatingNavBar.addView(spacer())
        floatingNavBar.addView(homeBtn)
        floatingNavBar.addView(spacer())
        floatingNavBar.addView(cookieFallbackButton)

        val navParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP or Gravity.CENTER_HORIZONTAL
        ).apply {
            topMargin = 36
        }
        root.addView(floatingNavBar, navParams)

        setContentView(root)

        configureWebView(webView)
        registerBackNavigation()

        val initialUrl = intent?.dataString?.takeIf { it.startsWith("https://music.youtube.com") } ?: startUrl
        webView.loadUrl(initialUrl)

        val filter = IntentFilter(MediaPlaybackService.ACTION_MEDIA_COMMAND)
        ContextCompat.registerReceiver(this, mediaControlReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    private fun loadMusicHome() {
        if (sanitizeUa) {
            webView.settings.userAgentString = chromeAndroidUa
        }
        webView.loadUrl(startUrl)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val deepLink = intent.dataString
        if (!deepLink.isNullOrBlank() && deepLink.startsWith("https://music.youtube.com")) {
            if (sanitizeUa) {
                webView.settings.userAgentString = chromeAndroidUa
            }
            webView.loadUrl(deepLink)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(view: WebView) {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(view, true)

        if (sanitizeUa && WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
            WebSettingsCompat.setRequestedWithHeaderOriginAllowList(view.settings, emptySet())
        }

        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportMultipleWindows(false)
            if (sanitizeUa) {
                userAgentString = chromeAndroidUa
            }
        }

        view.addJavascriptInterface(WebAppInterface(this), "YTMAndroidBridge")
        view.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                val resources = request?.resources ?: return
                val allowed = resources.filter {
                    it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
                }.toTypedArray()
                if (allowed.isNotEmpty()) {
                    request.grant(allowed)
                } else {
                    request.deny()
                }
            }
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                val host = url.host.orEmpty()
                val urlStr = url.toString()

                if (!isAllowedInAppHost(host)) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                    } catch (_: Exception) {}
                    return true
                }

                if (sanitizeUa && v != null) {
                    if (isGoogleAuthHost(host) && v.settings.userAgentString != firefoxAndroidUa) {
                        v.settings.userAgentString = firefoxAndroidUa
                        v.loadUrl(urlStr)
                        return true
                    } else if (host.equals("music.youtube.com", ignoreCase = true) && v.settings.userAgentString != chromeAndroidUa) {
                        v.settings.userAgentString = chromeAndroidUa
                        v.loadUrl(urlStr)
                        return true
                    }
                }

                return false
            }

            override fun onPageStarted(v: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(v, url, favicon)
                val host = try {
                    Uri.parse(url.orEmpty()).host.orEmpty()
                } catch (_: Exception) {
                    ""
                }
                val onMusic = host.equals("music.youtube.com", ignoreCase = true)
                floatingNavBar.visibility = if (onMusic) View.GONE else View.VISIBLE
                cookieFallbackButton.visibility = if (isGoogleAuthHost(host)) View.VISIBLE else View.GONE
            }

            override fun onPageFinished(v: WebView?, url: String?) {
                super.onPageFinished(v, url)
                CookieManager.getInstance().flush()
                injectClientEnhancements(v)
            }
        }
    }

    private fun showCookieImportDialog() {
        val input = EditText(this).apply {
            hint = "粘贴从浏览器复制的 music.youtube.com Cookie 字符串"
            minLines = 3
            maxLines = 6
        }
        AlertDialog.Builder(this)
            .setTitle("从浏览器同步登录 Cookie")
            .setMessage("如账号开启严格安全拦截，可在桌面或手机浏览器登录 music.youtube.com 后复制 Cookie 字符串粘贴到此处：")
            .setView(input)
            .setPositiveButton("导入并刷新") { _, _ ->
                val raw = input.text?.toString()?.trim().orEmpty().replace(Regex("^cookie:\\s*", RegexOption.IGNORE_CASE), "")
                if (raw.isBlank() || !raw.contains("=")) {
                    Toast.makeText(this, "未检测到有效的 Cookie 格式", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                val cm = CookieManager.getInstance()
                var count = 0
                raw.split(";").forEach { part ->
                    val trimmed = part.trim()
                    if (trimmed.contains("=")) {
                        cm.setCookie("https://music.youtube.com", "$trimmed; Path=/; Secure")
                        if (!trimmed.startsWith("__Host-")) {
                            cm.setCookie("https://.youtube.com", "$trimmed; Domain=.youtube.com; Path=/; Secure")
                        }
                        count += 1
                    }
                }
                cm.flush()
                loadMusicHome()
                Toast.makeText(this, "已导入 $count 条 Cookie，正在加载主页", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun injectClientEnhancements(view: WebView?) {
        val hideUpsellJs = """
            const style = document.createElement('style');
            style.textContent = 'ytmusic-mealbar-promo-renderer, .open-in-app-banner { display: none !important; }';
            document.head.appendChild(style);
            """

        val bridgeJs = """
            (function() {
              if (window.__ytmNativeInstalled) return;
              window.__ytmNativeInstalled = true;
              $hideUpsellJs
              let lastKey = '';
              let lastRecovery = 0;
              setInterval(function() {
                try {
                  const confirmBtn = document.querySelector('ytmusic-you-there-renderer yt-button-renderer button');
                  if (confirmBtn && confirmBtn.offsetParent !== null) confirmBtn.click();

                  const video = document.querySelector('video, audio');
                  const now = Date.now();
                  if (video && video.error && now - lastRecovery > 15000) {
                    lastRecovery = now;
                    const pos = video.currentTime || 0;
                    video.load();
                    if (pos > 2) { try { video.currentTime = pos; } catch (_) {} }
                    video.play().catch(function(){});
                  }

                  const meta = navigator.mediaSession && navigator.mediaSession.metadata;
                  const title = (meta && meta.title) || document.title.replace(' - YouTube Music', '') || 'YouTube Music';
                  const artist = (meta && meta.artist) || 'YouTube Music Web';
                  const playing = Boolean(video && !video.paused && !video.ended);
                  const key = title + '|' + artist + '|' + playing;
                  if (key !== lastKey && window.YTMAndroidBridge) {
                    lastKey = key;
                    window.YTMAndroidBridge.onPlaybackStateChanged(title, artist, playing);
                  }
                } catch (e) {}
              }, 1500);
            })();
        """.trimIndent()

        view?.evaluateJavascript(bridgeJs, null)
    }

    private fun dispatchJsPlaybackCommand(command: String) {
        val script = when (command) {
            "toggle" -> "(function(){ const btn = document.querySelector('#play-pause-button, .play-pause-button'); if (btn) { btn.click(); } else { const v = document.querySelector('video, audio'); if (v) v.paused ? v.play() : v.pause(); } })();"
            "next" -> "document.querySelector('.next-button')?.click();"
            "previous" -> "document.querySelector('.previous-button')?.click();"
            else -> return
        }
        webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun registerBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    moveTaskToBack(true)
                }
            }
        })
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    1001
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        webView.resumeTimers()
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
        // Intentionally DO NOT call webView.onPause() or pauseTimers() so audio continues in background!
    }

    override fun onDestroy() {
        unregisterReceiver(mediaControlReceiver)
        super.onDestroy()
    }
}
