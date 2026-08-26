package com.example.chattopdf

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.caverock.androidsvg.SVG
import com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import android.util.Base64

@Suppress("SetJavaScriptEnabled")
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var etUrl: EditText
    private lateinit var btnLoad: Button
    private lateinit var btnHome: Button
    private lateinit var fab: ExtendedFloatingActionButton

    private val storagePermissionCode = 1001
    private val homeUrl = "file:///android_asset/home.html"
    
    @Volatile private var exporting = false
    @Volatile private var received = false
    @Volatile private var exportToken = 0
    private var pageUrlForExport = ""
    private var uaForExport = ""

    private val pageWidth = 595
    private val pageHeight = 842
    private val marginLeft = 30f
    private val marginRight = 30f
    private val marginTop = 40f
    private val marginBottom = 50f
    private val contentWidth get() = pageWidth - marginLeft - marginRight

    private val codeStart = '\uE000'
    private val codeEnd = '\uE001'
    private val mediaStart = '\uE002'
    private val mediaEnd = '\uE003'

    private val MEDIA_TOP_PADDING = 6f
    private val MEDIA_BOTTOM_PADDING = 8f
    private val PLACEHOLDER_TEXT_HEIGHT = 24f
    private val MAX_DECODE_WIDTH_PX = 900
    private val BITMAP_BUDGET = 24 * 1024 * 1024L

    private val allBitmaps = mutableListOf<Bitmap>()
    private var bitmapBytes = 0L
    private val payloadBuf = StringBuilder()

    data class ChatMessage(val role: String, val text: String, val media: List<MediaItem> = emptyList())
    data class MediaItem(val type: String, val data: String, val w: Float, val h: Float)
    private data class Seg(val text: String, val isCode: Boolean, val mediaIndex: Int = -1)
    private class LineItem(
        val layout: StaticLayout?,
        val line: Int,
        val isCode: Boolean,
        val height: Float,
        val mediaIndex: Int = -1
    )
    private data class SizeF(val width: Float, val height: Float)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        etUrl = findViewById(R.id.etUrl)
        btnLoad = findViewById(R.id.btnLoad)
        btnHome = findViewById(R.id.btnHome)
        fab = findViewById(R.id.fabExportPdf)

        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.loadWithOverviewMode = true
        s.useWideViewPort = true
        s.setSupportZoom(true)
        s.builtInZoomControls = true
        s.displayZoomControls = false
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.userAgentString = s.userAgentString.replace("; wv", "")
        s.allowFileAccess = true
        s.allowContentAccess = true

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isScrollbarFadingEnabled = true
        
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: android.webkit.WebResourceRequest): Boolean {
                val u = req.url.toString()
                if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("file://")) return false
                return try {
                    startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, req.url))
                    true
                } catch (e: Exception) { true }
            }
        }
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(ChatBridge(), "AndroidPdfExporter")

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.loadUrl(homeUrl)
        btnHome.setOnClickListener { webView.loadUrl(homeUrl) }
        
        btnLoad.setOnClickListener {
            var url = etUrl.text.toString().trim()
            if (url.isNotEmpty()) {
                if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://$url"
                webView.loadUrl(url)
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.hideSoftInputFromWindow(etUrl.windowToken, 0)
            } else {
                Toast.makeText(this, "আগে একটা URL লিখুন", Toast.LENGTH_SHORT).show()
            }
        }

        fab.setOnClickListener {
            if (hasStoragePermission()) startExport() else requestStoragePermission()
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        webView.destroy()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    private fun hasStoragePermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return true
        return ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                PackageManager.PERMISSION_GRANTED
    }

    private fun requestStoragePermission() {
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), storagePermissionCode)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == storagePermissionCode) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) startExport()
            else Toast.makeText(this, "স্টোরেজ পারমিশন দরকার।", Toast.LENGTH_LONG).show()
        }
    }

    private fun startExport() {
        if (exporting) return
        val current = webView.url ?: ""
        if (current.startsWith("file:///android_asset")) {
            Toast.makeText(this, "আগে একটা AI চ্যাট খুলুন, তারপর Export চাপুন।", Toast.LENGTH_LONG).show()
            return
        }

        exporting = true
        received = false
        exportToken++
        val token = exportToken
        pageUrlForExport = current
        uaForExport = webView.settings.userAgentString ?: ""
        payloadBuf.setLength(0)

        fab.isEnabled = false
        fab.text = "পড়া হচ্ছে..."
        Toast.makeText(this, "পুরো চ্যাট স্ক্যান ও পড়া হচ্ছে, একটু সময় লাগবে...", Toast.LENGTH_SHORT).show()

        lifecycleScope.launch {
            val js = withContext(Dispatchers.IO) {
                try { assets.open("extract_chat.js").bufferedReader().use { it.readText() } }
                catch (e: Exception) { "" }
            }
            if (js.isNotEmpty()) webView.evaluateJavascript(js, null)
            else finishExport("JS ফাইল লোড করা যায়নি।")
        }

        fab.postDelayed({
            if (exporting && token == exportToken) finishExport("সময় শেষ — আবার চেষ্টা করুন।")
        }, 180000)
    }

    private fun finishExport(message: String) {
        exporting = false
        exportToken++
        fab.isEnabled = true
        fab.text = "Export PDF"
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    inner class ChatBridge {
        @JavascriptInterface
        fun reportStatus(s: String) {
            runOnUiThread {
                if (exporting) fab.text = if (s.length > 20) s.substring(0, 20) else s
            }
        }

        @JavascriptInterface
        fun receiveChunk(part: String, last: Int) {
            if (!exporting || received) return
            payloadBuf.append(part)
            if (last == 1) {
                val json = payloadBuf.toString()
                payloadBuf.setLength(0)
                receiveChatData(json)
            }
        }

        @JavascriptInterface
        fun receiveChatData(json: String) {
            if (!exporting || received) return
            received = true
            lifecycleScope.launch(Dispatchers.IO) {
                val result = try {
                    val (title, url, messages) = parsePayload(json)
                    if (messages.isEmpty()) {
                        "কোনো টেক্সট পাওয়া যায়নি! চ্যাট সম্পূর্ণ লোড হয়েছে কিনা দেখুন।"
                    } else {
                        val fileName = "Chat_Export_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.pdf"
                        val path = generateAndSavePdf(title, url, messages, fileName)
                        "✅ PDF সফল হয়েছে: $path"
                    }
                } catch (e: OutOfMemoryError) {
                    "মেমোরি অভাবে এক্সপোর্ট ব্যর্থ। অ্যাপ বন্ধ করে আবার চালু করুন।"
                } catch (e: Exception) {
                    "এক্সপোর্ট ব্যর্থ: ${e.message ?: "অজানা এরর"}"
                }
                withContext(Dispatchers.Main) { finishExport(result) }
            }
        }
    }

    private fun parsePayload(json: String): Triple<String, String, List<ChatMessage>> {
        val obj = JSONObject(json)
        val title = obj.optString("title", "Chat Export")
        val url = obj.optString("url", "")
        val list = mutableListOf<ChatMessage>()
        val arr = obj.optJSONArray("messages")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val m = arr.optJSONObject(i) ?: continue
                val text = m.optString("text", "").trim()
                val mediaArr = m.optJSONArray("media")
                val mediaList = mutableListOf<MediaItem>()
                if (mediaArr != null) {
                    for (j in 0 until mediaArr.length()) {
                        val mObj = mediaArr.optJSONObject(j) ?: continue
                        val data = mObj.optString("data", "")
                        if (data.isNotBlank()) {
                            mediaList.add(
                                MediaItem(
                                    mObj.optString("type", ""),
                                    data,
                                    mObj.optDouble("w", 0.0).toFloat(),
                                    mObj.optDouble("h", 0.0).toFloat()
                                )
                            )
                        }
                    }
                }
                if (text.isNotEmpty() || mediaList.isNotEmpty()) {
                    val role = if (m.optString("role", "ai") == "user") "user" else "ai"
                    list.add(ChatMessage(role, text, mediaList))
                }
            }
        }
        return Triple(title, url, list)
    }

    private fun prepareCode(code: String): String {
        val sb = StringBuilder()
        val lines = code.replace("\t", " ").split("\n")
        for ((i, line) in lines.withIndex()) {
            if (i > 0) sb.append('\n')
            var n = 0
            while (n < line.length && line[n] == ' ') n++
            repeat(n) { sb.append('\u00A0') }
            sb.append(line.substring(n))
        }
        return sb.toString().trimEnd()
    }

    private fun splitSegments(raw: String, media: List<MediaItem>): List<Seg> {
        if (raw.isBlank()) return emptyList()
        val out = mutableListOf<Seg>()
        var i = 0
        while (i < raw.length) {
            val stCode = raw.indexOf(codeStart, i)
            val stMedia = raw.indexOf(mediaStart, i)
            val st = when {
                stCode < 0 && stMedia < 0 -> -1
                stCode < 0 -> stMedia
                stMedia < 0 -> stCode
                else -> minOf(stCode, stMedia)
            }
            if (st < 0) {
                val remaining = raw.substring(i).trim()
                if (remaining.isNotEmpty()) out.add(Seg(remaining, false))
                break
            }
            val before = raw.substring(i, st).trim()
            if (before.isNotEmpty()) out.add(Seg(before, false))
            if (st == stCode) {
                val en = raw.indexOf(codeEnd, st + 1)
                val code = if (en < 0) raw.substring(st + 1) else raw.substring(st + 1, en)
                val prepared = prepareCode(code)
                if (prepared.isNotBlank()) out.add(Seg(prepared, true))
                i = if (en < 0) raw.length else en + 1
            } else {
                val en = raw.indexOf(mediaEnd, st + 1)
                val idxStr = if (en < 0) raw.substring(st + 1) else raw.substring(st + 1, en)
                val idx = idxStr.trim().toIntOrNull() ?: -1
                if (idx >= 0 && idx < media.size) {
                    out.add(Seg("", false, idx))
                }
                i = if (en < 0) raw.length else en + 1
            }
        }
        return out
    }

    private fun buildTextPaint(bold: Boolean, size: Float, color: Int, mono: Boolean = false): TextPaint {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
        paint.textSize = size
        paint.color = color
        val family = if (mono) Typeface.MONOSPACE else Typeface.SANS_SERIF
        paint.typeface = Typeface.create(family, if (bold) Typeface.BOLD else Typeface.NORMAL)
        return paint
    }

    private fun layoutOf(text: String, paint: TextPaint, width: Int, isCode: Boolean): StaticLayout {
        val safeWidth = if (width < 40) 40 else width
        val safeText = text.ifEmpty { "" }
        return StaticLayout.Builder.obtain(safeText, 0, safeText.length, paint, safeWidth)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setLineSpacing(4f, if (isCode) 1.25f else 1.40f)
            .setIncludePad(true)
            .setBreakStrategy(Layout.BREAK_STRATEGY_SIMPLE)
            .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
            .build()
    }

    private fun reqWidthNow(): Int = if (bitmapBytes > BITMAP_BUDGET) 480 else MAX_DECODE_WIDTH_PX

    private fun register(bmp: Bitmap?): Bitmap? {
        if (bmp != null) {
            allBitmaps.add(bmp)
            bitmapBytes += bmp.allocationByteCount.toLong()
        }
        return bmp
    }

    private fun calculateInSampleSize(options: BitmapFactory.Options, reqWidth: Int): Int {
        val width = options.outWidth
        var inSampleSize = 1
        if (width > reqWidth && reqWidth > 0) {
            val halfWidth = width / 2
            while (halfWidth / inSampleSize >= reqWidth) inSampleSize *= 2
        }
        return inSampleSize
    }

    private fun decodeSampledBitmap(bytes: ByteArray, reqWidth: Int): Bitmap? {
        return try {
            val boundsOptions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, boundsOptions)
            if (boundsOptions.outWidth <= 0 || boundsOptions.outHeight <= 0) return null
            val decodeOptions = BitmapFactory.Options().apply {
                inSampleSize = calculateInSampleSize(boundsOptions, reqWidth)
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOptions)
        } catch (e: OutOfMemoryError) { null } catch (e: Exception) { null }
    }

    private fun loadBitmapFromData(data: String, reqWidth: Int): Bitmap? {
        return try {
            when {
                data.startsWith("data:image") -> {
                    val base64Data = data.substringAfter(",", "")
                    if (base64Data.isEmpty()) null
                    else decodeSampledBitmap(Base64.decode(base64Data, Base64.DEFAULT), reqWidth)
                }
                data.startsWith("http://") || data.startsWith("https://") -> {
                    val conn = URL(data).openConnection() as HttpURLConnection
                    conn.connectTimeout = 8000
                    conn.readTimeout = 10000
                    conn.instanceFollowRedirects = true
                    conn.doInput = true
                    if (uaForExport.isNotBlank()) conn.setRequestProperty("User-Agent", uaForExport)
                    if (pageUrlForExport.isNotBlank()) conn.setRequestProperty("Referer", pageUrlForExport)
                    try {
                        CookieManager.getInstance().getCookie(data)?.let { conn.setRequestProperty("Cookie", it) }
                    } catch (e: Exception) {}
                    conn.connect()
                    val bytes = conn.inputStream.use { it.readBytes() }
                    conn.disconnect()
                    decodeSampledBitmap(bytes, reqWidth)
                }
                else -> null
            }
        } catch (e: OutOfMemoryError) { null } catch (e: Exception) { null }
    }

    private fun <T> cached(cache: MutableMap<Int, T?>, key: Int, loader: () -> T?): T? {
        if (cache.containsKey(key)) return cache[key]
        val v = loader()
        cache[key] = v
        return v
    }

    private fun mediaSizeOf(
        item: MediaItem,
        maxWidth: Float,
        maxHeight: Float,
        bitmapCache: MutableMap<Int, Bitmap?>,
        svgCache: MutableMap<Int, SVG?>,
        key: Int
    ): SizeF? {
        try {
            var w: Float
            var h: Float
            when (item.type) {
                "img" -> {
                    val bmp = cached(bitmapCache, key) {
                        register(loadBitmapFromData(item.data, reqWidthNow()))
                    } ?: return null
                    if (bmp.isRecycled) return null
                    w = bmp.width.toFloat(); h = bmp.height.toFloat()
                }
                "svg" -> {
                    val svg = cached(svgCache, key) {
                        try { SVG.getFromString(item.data) } catch (e: Exception) { null }
                    } ?: return null
                    val vb = svg.documentViewBox
                    w = when {
                        svg.documentWidth > 0f -> svg.documentWidth
                        vb != null && vb.width() > 0f -> vb.width()
                        item.w > 0f -> item.w
                        else -> maxWidth
                    }
                    h = when {
                        svg.documentHeight > 0f -> svg.documentHeight
                        vb != null && vb.height() > 0f -> vb.height()
                        item.h > 0f -> item.h
                        else -> w
                    }
                }
                else -> return null
            }
            if (w <= 0f || h <= 0f) return null
            if (w > maxWidth) { h *= maxWidth / w; w = maxWidth }
            if (h > maxHeight) { w *= maxHeight / h; h = maxHeight }
            if (w <= 0f || h <= 0f) return null
            return SizeF(w, h)
        } catch (e: Exception) {
            return null
        }
    }

    private fun drawMedia(
        canvas: Canvas,
        item: MediaItem,
        x: Float,
        y: Float,
        maxWidth: Float,
        maxHeight: Float,
        bitmapCache: MutableMap<Int, Bitmap?>,
        svgCache: MutableMap<Int, SVG?>,
        key: Int
    ) {
        val size = mediaSizeOf(item, maxWidth, maxHeight, bitmapCache, svgCache, key)
        if (size == null) {
            val p = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.GRAY; textSize = 11f }
            canvas.drawText("[ছবি লোড করা যায়নি]", x, y + 16f, p)
            return
        }
        try {
            if (item.type == "img") {
                val bmp = bitmapCache[key]
                if (bmp != null && !bmp.isRecycled) {
                    canvas.drawBitmap(bmp, null, RectF(x, y, x + size.width, y + size.height), null)
                }
            } else if (item.type == "svg") {
                val svg = svgCache[key]
                if (svg != null) {
                    canvas.save()
                    canvas.translate(x, y)
                    canvas.clipRect(0f, 0f, size.width, size.height)
                    svg.renderToCanvas(canvas, RectF(0f, 0f, size.width, size.height))
                    canvas.restore()
                }
            }
        } catch (e: Exception) {
            try { canvas.restore() } catch (e2: Exception) {}
        }
    }

    private fun measureMediaHeight(
        item: MediaItem,
        maxWidth: Float,
        maxHeight: Float,
        bitmapCache: MutableMap<Int, Bitmap?>,
        svgCache: MutableMap<Int, SVG?>,
        key: Int
    ): Float = mediaSizeOf(item, maxWidth, maxHeight, bitmapCache, svgCache, key)?.height
        ?: PLACEHOLDER_TEXT_HEIGHT

    private fun generateAndSavePdf(
        chatTitle: String,
        chatUrl: String,
        messages: List<ChatMessage>,
        fileName: String
    ): String {
        allBitmaps.clear()
        bitmapBytes = 0L
        val pdfDocument = PdfDocument()
        try {
            val userBgColor = Color.parseColor("#E8F5E9")
            val aiBgColor = Color.parseColor("#ECEFF1")
            val userBarColor = Color.parseColor("#2E7D32")
            val aiBarColor = Color.parseColor("#1565C0")

            val headerPaint = buildTextPaint(true, 15f, Color.parseColor("#0D47A1"))
            val smallPaint = buildTextPaint(false, 9f, Color.parseColor("#757575"))
            val userTitlePaint = buildTextPaint(true, 12.5f, Color.parseColor("#1B5E20"))
            val aiTitlePaint = buildTextPaint(true, 12.5f, Color.parseColor("#0D47A1"))
            val bodyPaint = buildTextPaint(false, 11.5f, Color.parseColor("#212121"))
            val codePaint = buildTextPaint(false, 9.3f, Color.parseColor("#102027"), mono = true)
            val codeBgPaint = Paint().apply { color = Color.parseColor("#F4F5F7") }
            val codeBarPaint = Paint().apply { color = Color.parseColor("#90A4AE") }
            val dividerPaint = Paint().apply { color = Color.parseColor("#BDBDBD"); strokeWidth = 1f }

            var pageNumber = 1
            var page = pdfDocument.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create())
            var canvas: Canvas = page.canvas
            var cursorY = marginTop

            fun drawFooter() {
                val label = "Page $pageNumber"
                canvas.drawText(label, (pageWidth - smallPaint.measureText(label)) / 2f, pageHeight - 20f, smallPaint)
            }

            fun startNewPage() {
                drawFooter()
                pdfDocument.finishPage(page)
                pageNumber++
                page = pdfDocument.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create())
                canvas = page.canvas
                cursorY = marginTop
            }

            val safeTitle = chatTitle.ifBlank { "Chat Export" }
            val titleLayout = layoutOf(safeTitle, headerPaint, contentWidth.toInt(), false)
            canvas.save(); canvas.translate(marginLeft, cursorY); titleLayout.draw(canvas); canvas.restore()
            cursorY += titleLayout.height + 6f

            val dateStr = SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.US).format(Date())
            val infoText = (if (chatUrl.isNotBlank()) "$chatUrl\n" else "") + "Exported: $dateStr | Total messages: ${messages.size}"
            val infoLayout = layoutOf(infoText, smallPaint, contentWidth.toInt(), false)
            canvas.save(); canvas.translate(marginLeft, cursorY); infoLayout.draw(canvas); canvas.restore()
            cursorY += infoLayout.height + 8f

            canvas.drawLine(marginLeft, cursorY, marginLeft + contentWidth, cursorY, dividerPaint)
            cursorY += 24f

            val barWidth = 6f
            val padding = 14f
            val innerWidth = contentWidth - barWidth - (padding * 2)
            val codeInset = 6f

            var questionNo = 0
            var answerNo = 0

            for (msg in messages) {
                if (msg.text.isBlank() && msg.media.isEmpty()) continue
                val isUser = msg.role == "user"
                if (isUser) questionNo++ else answerNo++

                val bitmapCache = HashMap<Int, Bitmap?>()
                val svgCache = HashMap<Int, SVG?>()

                val label = if (isUser) "USER | #$questionNo" else "AI | উত্তর #$answerNo"
                val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = if (isUser) userBgColor else aiBgColor }
                val barPaint = Paint().apply { color = if (isUser) userBarColor else aiBarColor }
                val titlePaint = if (isUser) userTitlePaint else aiTitlePaint

                val labelLayout = layoutOf(label, titlePaint, innerWidth.toInt(), false)
                val items = mutableListOf<LineItem>()
                val segments = splitSegments(msg.text, msg.media)

                val maxMediaHeight = (pageHeight - marginTop - marginBottom - padding * 2 -
                        labelLayout.height - 8f - MEDIA_TOP_PADDING - MEDIA_BOTTOM_PADDING - 6f).coerceAtLeast(150f)

                if (segments.isEmpty() && msg.media.isNotEmpty()) {
                    for (mi in msg.media.indices) {
                        val hh = measureMediaHeight(msg.media[mi], innerWidth, maxMediaHeight, bitmapCache, svgCache, mi)
                        items.add(LineItem(null, 0, false, hh + MEDIA_TOP_PADDING + MEDIA_BOTTOM_PADDING, mi))
                    }
                } else {
                    for (seg in segments) {
                        if (seg.isCode) {
                            if (seg.text.isBlank()) continue
                            val lay = layoutOf(seg.text, codePaint, (innerWidth - codeInset * 2).toInt(), true)
                            for (l in 0 until lay.lineCount) {
                                items.add(LineItem(lay, l, true, (lay.getLineBottom(l) - lay.getLineTop(l)).toFloat()))
                            }
                        } else if (seg.mediaIndex >= 0 && seg.mediaIndex < msg.media.size) {
                            val hh = measureMediaHeight(msg.media[seg.mediaIndex], innerWidth, maxMediaHeight, bitmapCache, svgCache, seg.mediaIndex)
                            items.add(LineItem(null, 0, false, hh + MEDIA_TOP_PADDING + MEDIA_BOTTOM_PADDING, seg.mediaIndex))
                        } else {
                            if (seg.text.isBlank()) continue
                            val lay = layoutOf(seg.text, bodyPaint, innerWidth.toInt(), false)
                            for (l in 0 until lay.lineCount) {
                                items.add(LineItem(lay, l, false, (lay.getLineBottom(l) - lay.getLineTop(l)).toFloat()))
                            }
                        }
                    }
                }

                if (items.isEmpty()) continue

                var pos = 0
                var firstChunk = true

                while (pos < items.size) {
                    val available = (pageHeight - marginBottom) - cursorY
                    val labelH = if (firstChunk) labelLayout.height + 8f else 0f
                    var count = 0
                    var textH = 0f

                    while (pos + count < items.size) {
                        val h = items[pos + count].height.coerceAtLeast(1f)
                        if (padding * 2 + labelH + textH + h > available && count > 0) break
                        textH += h
                        count++
                        if (count == 1 && padding * 2 + labelH + textH > available) break
                    }

                    if (padding * 2 + labelH + textH > available && cursorY > marginTop + 2f) {
                        startNewPage()
                        continue
                    }

                    if (count == 0) { count = 1; textH = items[pos].height.coerceAtLeast(1f) }

                    val chunkH = (padding * 2 + labelH + textH).coerceAtLeast(30f)
                    canvas.drawRoundRect(RectF(marginLeft, cursorY, marginLeft + contentWidth, cursorY + chunkH), 10f, 10f, bgPaint)
                    canvas.drawRect(RectF(marginLeft, cursorY, marginLeft + barWidth, cursorY + chunkH), barPaint)

                    var y = cursorY + padding
                    val xBase = marginLeft + barWidth + padding

                    if (firstChunk) {
                        canvas.save(); canvas.translate(xBase, y); labelLayout.draw(canvas); canvas.restore()
                        y += labelH
                    }

                    for (k in 0 until count) {
                        if (pos + k >= items.size) break
                        val item = items[pos + k]
                        if (item.isCode) {
                            canvas.drawRect(RectF(xBase - 2f, y, marginLeft + contentWidth - padding + 2f, y + item.height), codeBgPaint)
                            canvas.drawRect(RectF(xBase - 2f, y, xBase + 1f, y + item.height), codeBarPaint)
                        }
                        if (item.mediaIndex >= 0 && item.mediaIndex < msg.media.size) {
                            drawMedia(canvas, msg.media[item.mediaIndex], xBase, y + MEDIA_TOP_PADDING, innerWidth.toFloat(), maxMediaHeight, bitmapCache, svgCache, item.mediaIndex)
                        } else if (item.layout != null) {
                            try {
                                val top = item.layout.getLineTop(item.line).toFloat()
                                canvas.save()
                                canvas.translate(xBase + (if (item.isCode) codeInset else 0f), y)
                                canvas.translate(0f, -top)
                                canvas.clipRect(-6f, top - 3f, innerWidth + 6f, top + item.height + 3f)
                                item.layout.draw(canvas)
                                canvas.restore()
                            } catch (e: Exception) {}
                        }
                        y += item.height.coerceAtLeast(1f)
                    }

                    cursorY += chunkH
                    pos += count
                    firstChunk = false

                    if (pos < items.size) {
                        startNewPage()
                    } else {
                        cursorY += 10f
                        if (cursorY < pageHeight - marginBottom - 30f) {
                            canvas.drawLine(marginLeft + 40f, cursorY, marginLeft + contentWidth - 40f, cursorY, dividerPaint)
                        }
                        cursorY += 16f
                    }
                }
            }
            drawFooter()
            pdfDocument.finishPage(page)
            val path = writePdfToPublicDownloads(pdfDocument, fileName)
            return path
        } finally {
            pdfDocument.close()
            for (bmp in allBitmaps) {
                try { if (!bmp.isRecycled) bmp.recycle() } catch (e: Exception) {}
            }
            allBitmaps.clear()
            bitmapBytes = 0L
        }
    }

    private fun writePdfToPublicDownloads(pdfDocument: PdfDocument, fileName: String): String {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri: Uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("পাবলিক Downloads ফোল্ডারে ফাইল তৈরি করা গেল না।")
            resolver.openOutputStream(uri)?.use { pdfDocument.writeTo(it) }
                ?: throw IllegalStateException("আউটপুট স্ট্রিম খোলা গেল না")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            "/storage/emulated/0/Download/$fileName"
        } else {
            val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (!dir.exists()) dir.mkdirs()
            val file = File(dir, fileName)
            FileOutputStream(file).use { pdfDocument.writeTo(it) }
            MediaScannerConnection.scanFile(this, arrayOf(file.absolutePath), arrayOf("application/pdf"), null)
            file.absolutePath
        }
    }
}
