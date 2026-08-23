package com.example.chattopdf

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.text.StaticLayout
import android.text.TextPaint
import android.view.PixelCopy
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.coroutines.resume

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

        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isScrollbarFadingEnabled = true
        webView.webViewClient = WebViewClient()

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

    //==========================================
    // এক্সপোর্ট শুরু (ক্র্যাশ-প্রুফ)
    //==========================================
    private fun startExport() {
        if (exporting) return
        val current = webView.url ?: ""
        if (current.startsWith("file:///android_asset")) {
            Toast.makeText(this, "আগে একটি ওয়েবসাইট খুলুন, তারপর Export চাপুন।", Toast.LENGTH_LONG).show()
            return
        }
        exporting = true
        fab.isEnabled = false
        fab.text = "ক্যাপচার..."
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(etUrl.windowToken, 0)

        lifecycleScope.launch {
            val msg = try {
                withTimeout(150_000) { captureAndBuildPdf() }
            } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
                "সময় শেষ — আবার চেষ্টা করুন।"
            } catch (e: Exception) {
                "এক্সপোর্ট ব্যর্থ: ${e.message}"
            }
            finishExport(msg)
        }
    }

    private fun finishExport(message: String) {
        exporting = false
        try {
            fab.isEnabled = true
            fab.text = "Export PDF"
            fab.show()
        } catch (e: Exception) { }
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private suspend fun evalJs(js: String): String? = suspendCancellableCoroutine { cont ->
        try {
            webView.evaluateJavascript(js) { v -> if (!cont.isCompleted) cont.resume(v) }
        } catch (e: Exception) {
            if (!cont.isCompleted) cont.resume(null)
        }
    }

    //==========================================
    // পুরো পেজ স্ক্রিনশট হিসেবে ক্যাপচার + PDF
    //==========================================
    private suspend fun captureAndBuildPdf(): String {
        val helper = withContext(Dispatchers.IO) {
            assets.open("capture_helper.js").bufferedReader().use { it.readText() }
        }
        evalJs(helper)
        delay(300)

        val metricsRaw = evalJs("(window.__capMetrics ? window.__capMetrics() : ({sh:0,ch:0,top:0,left:0,w:0,h:0}))") ?: ""
        val m = try { JSONObject(metricsRaw) } catch (e: Exception) { null }
        val d = resources.displayMetrics.density

        var shCss = m?.optInt("sh", 0) ?: 0
        val chCss = m?.optInt("ch", 0) ?: 0
        var topDev = ((m?.optDouble("top", 0.0) ?: 0.0) * d).toInt()
        var leftDev = ((m?.optDouble("left", 0.0) ?: 0.0) * d).toInt()
        var wDev = ((m?.optDouble("w", 0.0) ?: 0.0) * d).toInt()
        var hDev = ((m?.optDouble("h", 0.0) ?: 0.0) * d).toInt()
        if (wDev <= 0 || hDev <= 0) { wDev = webView.width; hDev = webView.height; topDev = 0; leftDev = 0 }
        if (wDev <= 0 || hDev <= 0) return "WebView প্রস্তুত নয় — আবার চেষ্টা করুন।"
        if (shCss <= 0 || chCss <= 0) shCss = (hDev / d).toInt()
        val shDev = (shCss * d).toInt()

        // FAB লুকিয়ে নিই যেন স্ক্রিনশটে না আসে
        try { fab.hide() } catch (e: Exception) { }
        delay(350)

        // ধাপ ১: আগে একবার পুরো পেজ স্ক্রল করে lazy ছবি লোড করিয়ে নিই
        var y = 0
        var guard = 0
        val step = maxOf(300, (chCss * 0.8).toInt())
        while (y < shCss && guard < 120) {
            evalJs("window.__capScroll && window.__capScroll($y)")
            delay(100)
            y += step
            guard++
        }
        evalJs("window.__capScroll && window.__capScroll(0)")
        delay(500)

        // ধাপ ২: উপর থেকে নিচে অংশে অংশে স্ক্রিনশট
        val captures = mutableListOf<Pair<Int, Bitmap>>()
        var capturedUpTo = 0
        guard = 0
        val maxScrollDev = maxOf(0, shDev - hDev)
        while (capturedUpTo < shDev && guard < 80) {
            val scrollDev = minOf(capturedUpTo, maxScrollDev)
            evalJs("window.__capScroll && window.__capScroll(${(scrollDev / d).toInt()})")
            delay(300)
            val full = captureRegion(leftDev, topDev, wDev, hDev)
            if (full == null) { capturedUpTo += hDev; guard++; continue }
            val offset = capturedUpTo - scrollDev
            val newH = minOf(hDev - offset, shDev - capturedUpTo)
            if (newH > 10) {
                val piece = try { Bitmap.createBitmap(full, 0, offset, wDev, newH) } catch (e: Exception) { null }
                if (piece != null) {
                    captures.add(capturedUpTo to piece)
                    if (piece !== full) full.recycle()
                    capturedUpTo += newH
                } else {
                    full.recycle()
                    capturedUpTo += newH
                }
            } else {
                full.recycle()
                capturedUpTo += hDev
            }
            guard++
        }

        if (captures.isEmpty()) return "কোনো ছবি ক্যাপচার করা যায়নি! পেজটি লোড হয়েছে কিনা দেখুন।"

        // ধাপ ৩: মেমোরি নিরাপত্তার জন্য প্রয়োজনে ছোট করা
        val totalDevH = capturedUpTo
        var f = 1f
        if (wDev > 1200) f = 1200f / wDev
        val bytes = wDev.toDouble() * totalDevH.toDouble() * 2.0 * (f.toDouble() * f.toDouble())
        val cap = 28_000_000.0
        if (bytes > cap) f = (f * Math.sqrt(cap / bytes)).toFloat()
        val scaled = mutableListOf<Pair<Int, Bitmap>>()
        for ((start, bmp) in captures) {
            val nw = (bmp.width * f).toInt().coerceAtLeast(1)
            val nh = (bmp.height * f).toInt().coerceAtLeast(1)
            val sb = if (nw != bmp.width || nh != bmp.height) {
                val s = Bitmap.createScaledBitmap(bmp, nw, nh, true)
                bmp.recycle()
                s
            } else bmp
            scaled.add((start * f).toInt() to sb)
        }
        captures.clear()

        // ধাপ ৪: PDF তৈরি
        val title = webView.title ?: "Web Export"
        val url = webView.url ?: ""
        val fileName = "Chat_Export_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.pdf"
        val saved = try {
            withContext(Dispatchers.IO) { buildPdf(title, url, scaled, fileName) }
        } finally {
            for ((_, b) in scaled) { try { b.recycle() } catch (e: Exception) { } }
            scaled.clear()
        }
        return "✅ PDF সেভ হয়েছে: $saved"
    }

    private suspend fun captureRegion(left: Int, top: Int, w: Int, h: Int): Bitmap? {
        if (w <= 0 || h <= 0) return null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val bmp = suspendCancellableCoroutine<Bitmap?> { cont ->
                try {
                    val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    val loc = IntArray(2)
                    webView.getLocationInWindow(loc)
                    val rect = Rect(loc[0] + left, loc[1] + top, loc[0] + left + w, loc[1] + top + h)
                    PixelCopy.request(window, rect, b, { result ->
                        if (result == PixelCopy.SUCCESS) { if (!cont.isCompleted) cont.resume(b) }
                        else { b.recycle(); if (!cont.isCompleted) cont.resume(null) }
                    }, Handler(Looper.getMainLooper()))
                } catch (e: Exception) {
                    if (!cont.isCompleted) cont.resume(null)
                }
            }
            if (bmp != null) return bmp
        }
        return softwareCapture(left, top, w, h)
    }

    private fun softwareCapture(left: Int, top: Int, w: Int, h: Int): Bitmap? = try {
        val old = webView.layerType
        webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(Color.WHITE)
        c.translate(-left.toFloat(), -top.toFloat())
        webView.draw(c)
        webView.setLayerType(old, null)
        bmp
    } catch (e: Exception) { null }

    private fun buildPdf(title: String, url: String, caps: List<Pair<Int, Bitmap>>, fileName: String): String {
        val pdfDocument = PdfDocument()
        val headerPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 14f; color = Color.parseColor("#0D47A1")
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        val smallPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 9f; color = Color.parseColor("#757575") }
        val dividerPaint = Paint().apply { color = Color.parseColor("#BDBDBD"); strokeWidth = 1f }

        val scaledW = caps.first().second.width
        val ptPerPx = contentWidth / scaledW.toFloat()
        val totalH = caps.last().first + caps.last().second.height

        var pageNum = 1
        var cursor = 0
        var first = true

        while (cursor < totalH && pageNum <= 60) {
            val page = pdfDocument.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNum).create())
            val canvas = page.canvas
            var imgTop = marginTop

            if (first) {
                val safeTitle = title.ifBlank { "Web Export" }
                val tl = StaticLayout.Builder.obtain(safeTitle, 0, safeTitle.length, headerPaint, contentWidth.toInt()).build()
                canvas.save(); canvas.translate(marginLeft, imgTop); tl.draw(canvas); canvas.restore()
                imgTop += tl.height + 6f
                val dateStr = SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.US).format(Date())
                val info = (if (url.isNotBlank()) "$url\n" else "") + "Exported: $dateStr"
                val il = StaticLayout.Builder.obtain(info, 0, info.length, smallPaint, contentWidth.toInt()).build()
                canvas.save(); canvas.translate(marginLeft, imgTop); il.draw(canvas); canvas.restore()
                imgTop += il.height + 8f
                canvas.drawLine(marginLeft, imgTop, marginLeft + contentWidth, imgTop, dividerPaint)
                imgTop += 10f
            }

            val availH = pageHeight - marginBottom - imgTop
            val pagePx = (availH / ptPerPx).toInt()
            val end = minOf(cursor + pagePx, totalH)

            for ((start, bmp) in caps) {
                val bEnd = start + bmp.height
                if (bEnd <= cursor || start >= end) continue
                val oS = maxOf(cursor, start)
                val oE = minOf(end, bEnd)
                val src = Rect(0, oS - start, bmp.width, oE - start)
                val dst = RectF(
                    marginLeft,
                    imgTop + (oS - cursor) * ptPerPx,
                    marginLeft + contentWidth,
                    imgTop + (oE - cursor) * ptPerPx
                )
                canvas.drawBitmap(bmp, src, dst, null)
            }

            val label = "Page $pageNum"
            canvas.drawText(label, (pageWidth - smallPaint.measureText(label)) / 2f, pageHeight - 20f, smallPaint)
            pdfDocument.finishPage(page)

            cursor = end
            first = false
            pageNum++
        }

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
