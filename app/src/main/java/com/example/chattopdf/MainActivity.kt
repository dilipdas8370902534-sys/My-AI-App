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
    private val storagePermissionCode = 1001

    private val pageWidth = 595
    private val pageHeight = 842
    private val marginLeft = 30f
    private val marginRight = 30f
    private val marginTop = 40f
    private val marginBottom = 50f
    private val contentWidth get() = pageWidth - marginLeft - marginRight

    data class ChatMessage(val role: String, val text: String)

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
                Toast.makeText(this, "আগে একটি URL লিখুন", Toast.LENGTH_SHORT).show()
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
            Toast.makeText(this, "স্টোরেজ পারমিশন প্রয়োজন।", Toast.LENGTH_LONG).show()
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
                    val (title, url, messages) = parsePayload(json)
                    if (messages.isEmpty()) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@MainActivity, "কোনো টেক্সট পাওয়া যায়নি! চ্যাটটি সম্পূর্ণ লোড হয়েছে কিনা দেখুন।", Toast.LENGTH_LONG).show()
                        }
                        return@launch
                    }
                    val fileName = "Chat_Export_${SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())}.pdf"
                    val savedPath = generateAndSavePdf(title, url, messages, fileName)
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@MainActivity, "PDF সেভ হয়েছে: $savedPath", Toast.LENGTH_LONG).show()
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@MainActivity, "এক্সপোর্ট ব্যর্থ: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                }
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

    private fun buildTextPaint(bold: Boolean, size: Float, color: Int): TextPaint {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
        paint.textSize = size
        paint.color = color
        paint.typeface = Typeface.create(Typeface.SANS_SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL)
        return paint
    }

    private fun generateAndSavePdf(
        chatTitle: String,
        chatUrl: String,
        messages: List<ChatMessage>,
        fileName: String
    ): String {
        val pdfDocument = PdfDocument()

        // ===== রঙ: প্রশ্ন = সবুজ, উত্তর = ধূসর/নীল =====
        val userBgColor = Color.parseColor("#E8F5E9")
        val aiBgColor = Color.parseColor("#ECEFF1")
        val userBarColor = Color.parseColor("#2E7D32")
        val aiBarColor = Color.parseColor("#1565C0")
        val userTitleColor = Color.parseColor("#1B5E20")
        val aiTitleColor = Color.parseColor("#0D47A1")
        val textColor = Color.parseColor("#212121")

        val headerPaint = buildTextPaint(true, 15f, Color.parseColor("#0D47A1"))
        val smallPaint = buildTextPaint(false, 9f, Color.parseColor("#757575"))
        val userTitlePaint = buildTextPaint(true, 12.5f, userTitleColor)
        val aiTitlePaint = buildTextPaint(true, 12.5f, aiTitleColor)
        val bodyPaint = buildTextPaint(false, 11.5f, textColor)
        val dividerPaint = Paint().apply {
            color = Color.parseColor("#BDBDBD")
            strokeWidth = 1f
        }

        var pageNumber = 1
        var page = pdfDocument.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create())
        var canvas: Canvas = page.canvas
        var cursorY = marginTop

        fun drawFooter() {
            val label = "Page $pageNumber"
            val w = smallPaint.measureText(label)
            canvas.drawText(label, (pageWidth - w) / 2f, pageHeight - 20f, smallPaint)
        }

        fun startNewPage() {
            drawFooter()
            pdfDocument.finishPage(page)
            pageNumber++
            page = pdfDocument.startPage(PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create())
            canvas = page.canvas
            cursorY = marginTop
        }

        // ===== প্রথম পেজের হেডার (টাইটেল, লিংক, তারিখ) =====
        val safeTitle = if (chatTitle.isBlank()) "Chat Export" else chatTitle
        val titleLayout = StaticLayout.Builder.obtain(safeTitle, 0, safeTitle.length, headerPaint, contentWidth.toInt())
            .setAlignment(Layout.Alignment.ALIGN_NORMAL).build()
        canvas.save()
        canvas.translate(marginLeft, cursorY)
        titleLayout.draw(canvas)
        canvas.restore()
        cursorY += titleLayout.height + 6f

        val dateStr = SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.US).format(Date())
        val infoText = (if (chatUrl.isNotBlank()) "$chatUrl\n" else "") +
            "Exported: $dateStr  |  Total messages: ${messages.size}"
        val infoLayout = StaticLayout.Builder.obtain(infoText, 0, infoText.length, smallPaint, contentWidth.toInt())
            .setAlignment(Layout.Alignment.ALIGN_NORMAL).build()
        canvas.save()
        canvas.translate(marginLeft, cursorY)
        infoLayout.draw(canvas)
        canvas.restore()
        cursorY += infoLayout.height + 8f

        canvas.drawLine(marginLeft, cursorY, marginLeft + contentWidth, cursorY, dividerPaint)
        cursorY += 24f

        // ===== প্রতিটি মেসেজ আলাদা রঙের বাবলে =====
        val barWidth = 6f
        val padding = 14f
        val innerWidth = contentWidth - barWidth - (padding * 2)

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

            val labelLayout = StaticLayout.Builder.obtain(label, 0, label.length, titlePaint, innerWidth.toInt())
                .setAlignment(Layout.Alignment.ALIGN_NORMAL).build()
            val bodyLayout = StaticLayout.Builder.obtain(msg.text, 0, msg.text.length, bodyPaint, innerWidth.toInt())
                .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                .setLineSpacing(2f, 1.15f)
                .build()
            if (bodyLayout.lineCount == 0) continue

            var lineIndex = 0
            var isFirstChunk = true

            while (isFirstChunk || lineIndex < bodyLayout.lineCount) {
                val available = (pageHeight - marginBottom) - cursorY
                val labelH = if (isFirstChunk) labelLayout.height + 8f else 0f

                var linesFit = 0
                var textH = 0f
                while (lineIndex + linesFit < bodyLayout.lineCount) {
                    val lineH = (bodyLayout.getLineBottom(lineIndex + linesFit) - bodyLayout.getLineTop(lineIndex + linesFit)).toFloat()
                    if (padding * 2 + labelH + textH + lineH > available) break
                    textH += lineH
                    linesFit++
                }

                if (linesFit == 0) {
                    if (cursorY > marginTop + 2f) {
                        startNewPage()
                        continue
                    }
                    linesFit = 1
                    textH = (bodyLayout.getLineBottom(lineIndex) - bodyLayout.getLineTop(lineIndex)).toFloat()
                }

                val chunkH = padding * 2 + labelH + textH

                // বাবল + বাম পাশের রঙিন বার
                canvas.drawRoundRect(RectF(marginLeft, cursorY, marginLeft + contentWidth, cursorY + chunkH), 10f, 10f, bgPaint)
                canvas.drawRect(RectF(marginLeft, cursorY, marginLeft + barWidth, cursorY + chunkH), barPaint)

                canvas.save()
                canvas.translate(marginLeft + barWidth + padding, cursorY + padding)
                if (isFirstChunk) {
                    labelLayout.draw(canvas)
                    canvas.translate(0f, labelH)
                }
                val chunkTop = bodyLayout.getLineTop(lineIndex).toFloat()
                val chunkBottom = bodyLayout.getLineBottom(lineIndex + linesFit - 1).toFloat()
                canvas.clipRect(0f, chunkTop, innerWidth, chunkBottom)
                canvas.translate(0f, -chunkTop)
                bodyLayout.draw(canvas)
                canvas.restore()

                cursorY += chunkH
                lineIndex += linesFit
                isFirstChunk = false

                if (lineIndex < bodyLayout.lineCount) {
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
