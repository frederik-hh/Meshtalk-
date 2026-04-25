package com.meshtalk.app

import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MeshTalkWebView("file:///android_asset/index.html")
                }
            }
        }
    }
}

@Composable
fun MeshTalkWebView(url: String) {
    AndroidView(factory = { context ->
        WebView(context).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = true
                allowContentAccess = true
                databaseEnabled = true
                // Enable WebRTC features
                displayZoomControls = false
                builtInZoomControls = false
                useWideViewPort = true
                loadWithOverviewMode = true
            }
            webViewClient = WebViewClient()
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    // Automatically grant permissions for WebRTC features (Camera/Audio)
                    request.grant(request.resources)
                }
            }
            loadUrl(url)
        }
    }, modifier = Modifier.fillMaxSize())
}
