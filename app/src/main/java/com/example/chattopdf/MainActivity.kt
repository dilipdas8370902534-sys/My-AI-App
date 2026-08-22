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
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
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
    private val storagePermissionCode = 1001

    private val pageWidth = 595
    private val pageHeight = 842
    private val marginLeft = 30f
    private val marginRight = 30f
    private val marginTop = 40f
    private val marginBottom = 40f
    private val contentWidth get() = pageWidth - marginLeft - marginRight

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        etUrl = findViewById(R.id.etUrl)
        btnLoad = findViewById(R.id.btnLoad)
        val fab = findViewById<ExtendedFloatingActionButton>(R.id.fabExportPdf)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = WebViewClient()
        webView.addJavascriptInterface(ChatBridge(), "AndroidPdfExporter")
        webView.loadUrl("https://chat.qwen.ai")

        btnLoad.setOnClickListener {
            var url = etUrl.text.toString().trim()
            if (url.isNotEmpty()) {
                if (!url.startsWith("http://") && !url.startsWith("https://")) { url = "https://$url" }
                webView.loadUrl(url)
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.hideSoftInputFromWindow(etUrl.windowToken, 0)
            } else {
                Toast.makeText(this, "Please enter a URL", Toast.LENGTH_SHORT).show()
            }
        }

        fab.setOnClickListener {
            if (hasStoragePermission()) {
                injectExtractionScript()
            } else {
                requestStoragePermission()
            }
        }
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
        if (requestCode == storagePermissionCode && grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            injectExtractionScript()
        } else if (requestCode == storagePermissionCode) {
            Toast.makeText(this, "Storage permission is required.", Toast.LENGTH_LONG).show()
        }
    }

    private fun injectExtractionScript() {
        val js = assets.open("extract_chat.js").bufferedReader().use { it.readText() }
        webView.evaluateJavascript(js, null)
    }

    inner class ChatBridge {
        @JavascriptInterface
        fun receiveChatData(json: String) {
            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    val messages = parseMessages(json)
                    if (messages.isEmpty()) {
                        withContext(Dispatchers.Main) { Toast.makeText(this@MainActivity, "No text could be extracted.", Toast.LENGTH_LONG).show() }
                        return@launch
                    }
                    val fileName = "Chat_Export_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.pdf"
                    val savedPath = generateAndSaveBeautifulPdf(messages, fileName)
                    withContext(Dispatchers.Main) { Toast.makeText(this@MainActivity, "PDF saved to: $savedPath", Toast.LENGTH_LONG).show() }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) { Toast.makeText(this@MainActivity, "Export failed: ${e.message}", Toast.LENGTH_LONG).show() }
                }
            }
        }
    }

    private fun parseMessages(json: String): List<Pair<String, String>> {
        val result = mutableListOf<Pair<String, String>>()
        val array = JSONArray(json)
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            val text = obj.optString("text", "").trim()
            if (text.isNotEmpty()) result.add(obj.optString("role", "ai") to text)
        }
        return result
    }

    private fun buildTextPaint(bold: Boolean, size: Float, color: Int): TextPaint {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
        paint.textSize = size
        paint.color = color
        paint.typeface = Typeface.create(Typeface.SANS_SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL)
        return paint
    }

    private fun generateAndSaveBeautifulPdf(messages: List<Pair<String, String>>, fileName: String): String {
        val pdfDocument = PdfDocument()

        val userBgColor = Color.parseColor("#E3F2FD")
        val aiBgColor = Color.parseColor("#F5F5F5")
        val userTitleColor = Color.parseColor("#1565C0")
        val aiTitleColor = Color.parseColor("#424242")
        val textColor = Color.parseColor("#212121")

        val userTitlePaint = buildTextPaint(true, 13f, userTitleColor)
        val aiTitlePaint = buildTextPaint(true, 13f, aiTitleColor)
        val bodyPaint = buildTextPaint(false, 11.5f, textColor)

        var pageNumber = 1
        var page = pdfDocument.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create())
        var canvas: Canvas = page.canvas
        var cursorY = marginTop

        fun startNewPage() {
            pdfDocument.finishPage(page)
            pageNumber++
            page = pdfDocument.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create())
            canvas = page.canvas
            cursorY = marginTop
        }

        val padding = 16f
        val innerWidth = contentWidth - (padding * 2)

        for ((role, text) in messages) {
            val isUser = role == "user"
            val bgPaint = Paint().apply { color = if (isUser) userBgColor else aiBgColor }
            val titlePaint = if (isUser) userTitlePaint else aiTitlePaint
            val label = if (isUser) "\uD83E\uDDD1\u200D\uD83D\uDCBB USER" else "\uD83E\uDD16 AI"

            val labelLayout = StaticLayout.Builder.obtain(label, 0, label.length, titlePaint, innerWidth.toInt())
                .setAlignment(Layout.Alignment.ALIGN_NORMAL).build()
            val bodyLayout = StaticLayout.Builder.obtain(text, 0, text.length, bodyPaint, innerWidth.toInt())
                .setAlignment(Layout.Alignment.ALIGN_NORMAL).setLineSpacing(2f, 1.2f).build()

            var currentLine = 0
            var isFirstPart = true

            while (currentLine < bodyLayout.lineCount || isFirstPart) {
                val availableHeight = (pageHeight - marginBottom) - cursorY
                var fitHeight = 0f
                var linesToDraw = 0
                val labelHeight = if (isFirstPart) labelLayout.height.toFloat() + 8f else 0f

                for (i in currentLine until bodyLayout.lineCount) {
                    val lh = (bodyLayout.getLineBottom(i) - bodyLayout.getLineTop(i)).toFloat()
                    if (labelHeight + fitHeight + lh + (padding * 2) > availableHeight && (!isFirstPart || linesToDraw > 0)) {
                        break
                    }
                    fitHeight += lh
                    linesToDraw++
                }

                val totalDrawHeight = labelHeight + fitHeight + (padding * 2)

                val rect = RectF(marginLeft, cursorY, marginLeft + contentWidth, cursorY + totalDrawHeight)
                canvas.drawRoundRect(rect, 12f, 12f, bgPaint)

                canvas.save()
                canvas.translate(marginLeft + padding, cursorY + padding)
                if (isFirstPart) {
                    labelLayout.draw(canvas)
                    canvas.translate(0f, labelHeight)
                }

                val chunkTop = bodyLayout.getLineTop(currentLine).toFloat()
                val chunkBottom = bodyLayout.getLineBottom(currentLine + linesToDraw - 1).toFloat()
                canvas.translate(0f, -chunkTop)
                canvas.clipRect(0f, chunkTop, innerWidth, chunkBottom)
                bodyLayout.draw(canvas)
                canvas.restore()

                cursorY += totalDrawHeight + 20f
                currentLine += linesToDraw
                isFirstPart = false

                if (currentLine < bodyLayout.lineCount) startNewPage()
            }

            if (cursorY > pageHeight - marginBottom - 40f) startNewPage()
        }

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
                ?: throw IllegalStateException("Unable to create the file in the public Downloads folder.")

            resolver.openOutputStream(uri)?.use { pdfDocument.writeTo(it) }
                ?: throw IllegalStateException("Unable to open an output stream for $uri")

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
