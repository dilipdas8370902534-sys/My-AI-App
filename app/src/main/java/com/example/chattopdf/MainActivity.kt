package com.example.chattopdf

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
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
import java.io.OutputStream
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
    private val marginLeft = 40
    private val marginRight = 40
    private val marginTop = 48
    private val marginBottom = 48
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
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    url = "https://$url"
                }
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
        return ContextCompat.checkSelfPermission(
            this, Manifest.permission.WRITE_EXTERNAL_STORAGE
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestStoragePermission() {
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE),
            storagePermissionCode
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == storagePermissionCode &&
            grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        ) {
            injectExtractionScript()
        } else if (requestCode == storagePermissionCode) {
            Toast.makeText(this, "Storage permission is required to save the PDF.", Toast.LENGTH_LONG).show()
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
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@MainActivity, "No text could be extracted.", Toast.LENGTH_LONG).show()
                        }
                        return@launch
                    }
                    val fileName = buildFileName()
                    val savedPath = generateAndSavePdf(messages, fileName)
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@MainActivity, "PDF saved to: $savedPath", Toast.LENGTH_LONG).show()
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@MainActivity, "Export failed: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    private fun parseMessages(json: String): List<Pair<String, String>> {
        val result = mutableListOf<Pair<String, String>>()
        val array = JSONArray(json)
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            val role = obj.optString("role", "ai")
            val text = obj.optString("text", "").trim()
            if (text.isNotEmpty()) {
                result.add(role to text)
            }
        }
        return result
    }

    private fun buildFileName(): String {
        val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        return "Chat_Export_$timestamp.pdf"
    }

    private fun buildTextPaint(bold: Boolean, size: Float, color: Int): TextPaint {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
        paint.isAntiAlias = true
        paint.isSubpixelText = true
        paint.textSize = size
        paint.color = color
        paint.typeface = Typeface.create(Typeface.SANS_SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL)
        return paint
    }

    private fun generateAndSavePdf(messages: List<Pair<String, String>>, fileName: String): String {
        val pdfDocument = PdfDocument()
        val titlePaintUser = buildTextPaint(true, 13f, Color.rgb(0, 90, 160))
        val titlePaintAi = buildTextPaint(true, 13f, Color.rgb(0, 130, 90))
        val bodyPaint = buildTextPaint(false, 12f, Color.rgb(30, 30, 30))
        val dividerPaint = Paint().apply {
            color = Color.rgb(220, 220, 220)
            strokeWidth = 1f
        }

        var pageNumber = 1
        var page = pdfDocument.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create())
        var canvas: Canvas = page.canvas
        var cursorY = marginTop.toFloat()

        fun startNewPage() {
            pdfDocument.finishPage(page)
            pageNumber++
            page = pdfDocument.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create())
            canvas = page.canvas
            cursorY = marginTop.toFloat()
        }

        fun drawBlock(text: String, paint: TextPaint, topSpacing: Float) {
            val layout = StaticLayout.Builder
                .obtain(text, 0, text.length, paint, contentWidth)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                .setLineSpacing(2f, 1.1f)
                .setIncludePad(false)
                .build()

            if (cursorY + topSpacing > pageHeight - marginBottom) {
                startNewPage()
            }
            cursorY += topSpacing

            var lineStart = 0
            val lineCount = layout.lineCount
            while (lineStart < lineCount) {
                val availableHeight = (pageHeight - marginBottom) - cursorY
                if (availableHeight < paint.textSize) {
                    startNewPage()
                    continue
                }
                var lineEnd = lineStart
                var usedHeight = 0f
                while (lineEnd < lineCount) {
                    val lh = (layout.getLineBottom(lineEnd) - layout.getLineTop(lineEnd)).toFloat()
                    if (usedHeight + lh > availableHeight && lineEnd > lineStart) break
                    usedHeight += lh
                    lineEnd++
                }
                val top = layout.getLineTop(lineStart)
                val bottom = layout.getLineBottom(lineEnd - 1)
                canvas.save()
                canvas.translate(marginLeft.toFloat(), cursorY - top)
                canvas.clipRect(0f, top.toFloat(), contentWidth.toFloat(), bottom.toFloat())
                layout.draw(canvas)
                canvas.restore()
                cursorY += usedHeight
                lineStart = lineEnd
                if (lineStart < lineCount) startNewPage()
            }
        }

        for ((role, text) in messages) {
            val isUser = role.equals("user", ignoreCase = true)
            val label = if (isUser) "\uD83E\uDDD1\u200D\uD83D\uDCBB USER:" else "\uD83E\uDD16 AI:"
            val titlePaint = if (isUser) titlePaintUser else titlePaintAi

            drawBlock(label, titlePaint, 14f)
            drawBlock(text, bodyPaint, 4f)

            if (cursorY + 12f > pageHeight - marginBottom) {
                startNewPage()
            } else {
                cursorY += 8f
                canvas.drawLine(marginLeft.toFloat(), cursorY, (pageWidth - marginRight).toFloat(), cursorY, dividerPaint)
                cursorY += 12f
            }
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
                ?: throw IllegalStateException("Unable to create file in MediaStore Downloads collection.")

            resolver.openOutputStream(uri)?.use { out: OutputStream ->
                pdfDocument.writeTo(out)
            } ?: throw IllegalStateException("Unable to open output stream for $uri")

            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)

            "/storage/emulated/0/Download/$fileName"
        } else {
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (!downloadsDir.exists()) downloadsDir.mkdirs()
            val outFile = File(downloadsDir, fileName)
            FileOutputStream(outFile).use { out ->
                pdfDocument.writeTo(out)
            }
            MediaScannerConnection.scanFile(this, arrayOf(outFile.absolutePath), arrayOf("application/pdf"), null)
            outFile.absolutePath
        }
    }
}
