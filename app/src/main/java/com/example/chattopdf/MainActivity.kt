package com.example.chattopdf

import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.os.Bundle
import android.os.Environment
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONTokener
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var etUrl: EditText
    private lateinit var btnLoad: Button
    private lateinit var btnExtract: Button
    private lateinit var btnGeneratePdf: Button
    private lateinit var tvExtractedText: TextView
    private lateinit var progressBar: ProgressBar

    companion object {
        private const val TAG = "ChatToPDF"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        etUrl = findViewById(R.id.etUrl)
        btnLoad = findViewById(R.id.btnLoad)
        btnExtract = findViewById(R.id.btnExtract)
        btnGeneratePdf = findViewById(R.id.btnGeneratePdf)
        tvExtractedText = findViewById(R.id.tvExtractedText)
        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)

        setupWebView()

        btnLoad.setOnClickListener {
            var url = etUrl.text.toString().trim()
            if (url.isEmpty()) {
                Toast.makeText(this, "Please enter a URL", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "https://$url"
            }
            progressBar.visibility = View.VISIBLE
            webView.loadUrl(url)
        }

        btnExtract.setOnClickListener {
            extractChatText()
        }

        btnGeneratePdf.setOnClickListener {
            generatePdf()
        }
    }

    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        webView.addJavascriptInterface(ChatExtractorInterface(), "AndroidExtractor")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                Toast.makeText(this@MainActivity, "Page loaded. Tap Extract Chat when ready.", Toast.LENGTH_SHORT).show()
            }

            override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
                super.onReceivedError(view, errorCode, description, failingUrl)
                progressBar.visibility = View.GONE
                Log.e(TAG, "Load error: " + description)
            }
        }
    }

    private fun extractChatText() {
        val script = "(function(){function c(t){return (t||'').replace(/\\s+/g,' ').trim();}var sel=['[class*=\"message\"]','[class*=\"chat\"]','[class*=\"bubble\"]','[data-testid*=\"message\"]','article','main'];var out=[];for(var i=0;i<sel.length;i++){var n=document.querySelectorAll(sel[i]);if(n&&n.length>3){for(var j=0;j<n.length;j++){var t=c(n[j].innerText);if(t.length>0)out.push(t);}if(out.length>0)break;}}if(out.length===0){out.push(c(document.body.innerText));}return JSON.stringify(out);})();"

        webView.evaluateJavascript(script) { result ->
            try {
                val raw = result ?: "\"[]\""
                val inner = JSONTokener(raw).nextValue().toString()
                val arr = JSONArray(inner)
                val sb = StringBuilder()
                for (i in 0 until arr.length()) {
                    sb.append(arr.getString(i))
                    sb.append("\n\n---\n\n")
                }
                runOnUiThread {
                    tvExtractedText.text = if (sb.isEmpty()) "No text found." else sb.toString()
                }
            } catch (e: JSONException) {
                Log.e(TAG, "Failed to parse extracted JSON", e)
                runOnUiThread {
                    tvExtractedText.text = "Extraction failed: " + e.message
                }
            }
        }
    }

    inner class ChatExtractorInterface {
        @JavascriptInterface
        fun receiveText(text: String) {
            runOnUiThread {
                tvExtractedText.text = text
            }
        }
    }

    private fun generatePdf() {
        val content = tvExtractedText.text.toString()
        if (content.isBlank() || content == "No text found.") {
            Toast.makeText(this, "Nothing to export. Extract chat text first.", Toast.LENGTH_SHORT).show()
            return
        }

        try {
            val pdfDocument = PdfDocument()
            val pageWidth = 595
            val pageHeight = 842
            val margin = 40f
            val paint = Paint()
            paint.textSize = 12f
            paint.color = Color.BLACK

            val lineHeight = paint.descent() - paint.ascent()
            val maxLineWidth = pageWidth - (2 * margin)

            val lines = mutableListOf<String>()
            for (paragraph in content.split("\n")) {
                if (paragraph.isBlank()) {
                    lines.add("")
                    continue
                }
                val words = paragraph.split(" ")
                var currentLine = StringBuilder()
                for (word in words) {
                    val candidate = if (currentLine.isEmpty()) word else currentLine.toString() + " " + word
                    if (paint.measureText(candidate) > maxLineWidth && currentLine.isNotEmpty()) {
                        lines.add(currentLine.toString())
                        currentLine = StringBuilder(word)
                    } else {
                        currentLine = StringBuilder(candidate)
                    }
                }
                if (currentLine.isNotEmpty()) {
                    lines.add(currentLine.toString())
                }
            }

            var pageNumber = 1
            var lineIndex = 0
            val linesPerPage = ((pageHeight - (2 * margin)) / lineHeight).toInt()

            while (lineIndex < lines.size) {
                val pageInfo = PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create()
                val page = pdfDocument.startPage(pageInfo)
                val canvas = page.canvas
                var y = margin - paint.ascent()

                var linesOnPage = 0
                while (lineIndex < lines.size && linesOnPage < linesPerPage) {
                    canvas.drawText(lines[lineIndex], margin, y, paint)
                    y += lineHeight
                    lineIndex++
                    linesOnPage++
                }

                pdfDocument.finishPage(page)
                pageNumber++
            }

            val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val fileName = "ChatExport_" + timeStamp + ".pdf"

            val outputDir = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS) ?: filesDir
            if (!outputDir.exists()) {
                outputDir.mkdirs()
            }
            val file = File(outputDir, fileName)

            FileOutputStream(file).use { fos ->
                pdfDocument.writeTo(fos)
            }
            pdfDocument.close()

            Toast.makeText(this, "PDF saved: " + file.absolutePath, Toast.LENGTH_LONG).show()
        } catch (e: IOException) {
            Log.e(TAG, "PDF generation failed", e)
            Toast.makeText(this, "Failed to generate PDF: " + e.message, Toast.LENGTH_LONG).show()
        }
    }
}
