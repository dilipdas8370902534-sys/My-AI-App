package com.example.chattopdf

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
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
import com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

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

    private val pageWidth = 595
    private val pageHeight = 842
    private val marginLeft = 30f
    private val marginRight = 30f
    private val marginTop = 40f
    private val marginBottom = 50f
    private val contentWidth get() = pageWidth - marginLeft - marginRight

    private val codeStart = '\uE000'
    private val codeEnd = '\uE001'

    data class ChatMessage(val role: String, val text: String)
    private data class Seg(val text: String, val isCode: Boolean)
    private class LineItem(val layout: StaticLayout, val line: Int, val isCode: Boolean, val height: Float)

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
        s.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        s.userAgentString = s.userAgentString.replace("; wv", "")

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isScrollbarFadingEnabled = true
        webView.webViewClient = WebViewClient()
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
                Toast.makeText(this, "আগে একটি URL লিখুন", Toast.LENGTH_SHORT).show()
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
        return ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestStoragePermission() {
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), storagePermissionCode)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == storagePermissionCode) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) startExport()
            else Toast.makeText(this, "স্টোরেজ পারমিশন প্রয়োজন।", Toast.LENGTH_LONG).show()
        }
    }

    private fun startExport() {
        if (exporting) return
        val current = webView.url ?: ""
        if (current.startsWith("file:///android_asset")) {
            Toast.makeText(this, "আগে একটি AI চ্যাট খুলুন, তারপর Export চাপুন।", Toast.LENGTH_LONG).show()
            return
        }
        exporting = true
        fab.isEnabled = false
        fab.text = "পড়া হচ্ছে..."
        Toast.makeText(this, "পুরো চ্যাট স্ক্রল করে পড়া হচ্ছে, একটু অপেক্ষা করুন...", Toast.LENGTH_SHORT).show()

        lifecycleScope.launch {
            val js = withContext(Dispatchers.IO) {
                assets.open("extract_chat.js").bufferedReader().use { it.readText() }
            }
            webView.evaluateJavascript(js, null)
        }
        fab.postDelayed({ if (exporting) finishExport("সময় শেষ — আবার চেষ্টা করুন।") }, 120000)
    }

    private fun finishExport(message: String) {
        exporting = false
        fab.isEnabled = true
        fab.text = "Export PDF"
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    inner class ChatBridge {
        @JavascriptInterface
        fun receiveChatData(json: String) {
            lifecycleScope.launch(Dispatchers.IO) {
                val result = try {
                    val (title, url, messages) = parsePayload(json)
                    if (messages.isEmpty()) "কোনো টেক্সট পাওয়া যায়নি! চ্যাটটি সম্পূর্ণ লোড হয়েছে কিনা দেখুন।"
                    else {
                        val fileName = "Chat_Export_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.pdf"
                        "✅ PDF সেভ হয়েছে: " + generateAndSavePdf(title, url, messages, fileName)
                    }
                } catch (e: Exception) {
                    "এক্সপোর্ট ব্যর্থ: ${e.message}"
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
                if (text.isNotEmpty()) {
                    val role = if (m.optString("role", "ai") == "user") "user" else "ai"
                    list.add(ChatMessage(role, text))
                }
            }
        }
        return Triple(title, url, list)
    }

    // ---------- কোড ব্লক আলাদা করা ----------

    private fun prepareCode(code: String): String {
        val sb = StringBuilder()
        val lines = code.replace("\t", "    ").split("\n")
        for ((i, line) in lines.withIndex()) {
            if (i > 0) sb.append('\n')
            var n = 0
            while (n < line.length && line[n] == ' ') n++
            repeat(n) { sb.append('\u00A0') }   // ইনডেন্ট ধরে রাখতে non-breaking space
            sb.append(line.substring(n))
        }
        return sb.toString().trimEnd()
    }

    private fun splitSegments(raw: String): List<Seg> {
        val out = mutableListOf<Seg>()
        var i = 0
        while (i < raw.length) {
            val st = raw.indexOf(codeStart, i)
            if (st < 0) {
                raw.substring(i).trim().takeIf { it.isNotEmpty() }?.let { out.add(Seg(it, false)) }
                break
            }
            raw.substring(i, st).trim().takeIf { it.isNotEmpty() }?.let { out.add(Seg(it, false)) }
            val en = raw.indexOf(codeEnd, st + 1)
            val code = if (en < 0) raw.substring(st + 1) else raw.substring(st + 1, en)
            prepareCode(code).takeIf { it.isNotBlank() }?.let { out.add(Seg(it, true)) }
            if (en < 0) break
            i = en + 1
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
        return StaticLayout.Builder.obtain(text, 0, text.length, paint, if (width < 40) 40 else width)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setLineSpacing(0f, if (isCode) 1.1f else 1.15f)
            .setIncludePad(false)
            .setBreakStrategy(Layout.BREAK_STRATEGY_SIMPLE)
            .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
            .build()
    }

    // ---------- PDF ----------

    private fun generateAndSavePdf(
        chatTitle: String,
        chatUrl: String,
        messages: List<ChatMessage>,
        fileName: String
    ): String {
        val pdfDocument = PdfDocument()

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
        val infoText = (if (chatUrl.isNotBlank()) "$chatUrl\n" else "") +
            "Exported: $dateStr  |  Total messages: ${messages.size}"
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
            if (msg.text.isBlank()) continue
            val isUser = msg.role == "user"
            if (isUser) questionNo++ else answerNo++

            val label = if (isUser) "USER  |  প্রশ্ন #$questionNo" else "AI  |  উত্তর #$answerNo"
            val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = if (isUser) userBgColor else aiBgColor }
            val barPaint = Paint().apply { color = if (isUser) userBarColor else aiBarColor }
            val titlePaint = if (isUser) userTitlePaint else aiTitlePaint

            val labelLayout = layoutOf(label, titlePaint, innerWidth.toInt(), false)

            val items = mutableListOf<LineItem>()
            for (seg in splitSegments(msg.text)) {
                if (seg.text.isBlank()) continue
                val paint = if (seg.isCode) codePaint else bodyPaint
                val w = if (seg.isCode) (innerWidth - codeInset * 2).toInt() else innerWidth.toInt()
                val lay = layoutOf(seg.text, paint, w, seg.isCode)
                for (l in 0 until lay.lineCount) {
                    items.add(LineItem(lay, l, seg.isCode, (lay.getLineBottom(l) - lay.getLineTop(l)).toFloat()))
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
                    val h = items[pos + count].height
                    if (padding * 2 + labelH + textH + h > available && (!firstChunk || count > 0)) break
                    textH += h
                    count++
                }

                if (count == 0) {
                    if (cursorY > marginTop + 2f) { startNewPage(); continue }
                    count = 1
                    textH = items[pos].height
                }

                val chunkH = padding * 2 + labelH + textH
                canvas.drawRoundRect(RectF(marginLeft, cursorY, marginLeft + contentWidth, cursorY + chunkH), 10f, 10f, bgPaint)
                canvas.drawRect(RectF(marginLeft, cursorY, marginLeft + barWidth, cursorY + chunkH), barPaint)

                var y = cursorY + padding
                val xBase = marginLeft + barWidth + padding

                if (firstChunk) {
                    canvas.save(); canvas.translate(xBase, y); labelLayout.draw(canvas); canvas.restore()
                    y += labelH
                }

                for (k in 0 until count) {
                    val item = items[pos + k]
                    if (item.isCode) {
                        canvas.drawRect(RectF(xBase - 2f, y, marginLeft + contentWidth - padding + 2f, y + item.height), codeBgPaint)
                        canvas.drawRect(RectF(xBase - 2f, y, xBase + 1f, y + item.height), codeBarPaint)
                    }
                    val top = item.layout.getLineTop(item.line).toFloat()
                    canvas.save()
                    canvas.translate(xBase + (if (item.isCode) codeInset else 0f), y)
                    canvas.translate(0f, -top)
                    canvas.clipRect(0f, top, innerWidth, top + item.height)
                    item.layout.draw(canvas)
                    canvas.restore()
                    y += item.height
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
        val savedPath = writePdfToPublicDownloads(pdfDocument, fileName)
        pdfDocument.close()
        return savedPath
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
                ?: throw IllegalStateException("আউটপুট স্ট্রিম খোলা গেল না: $uri")
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
