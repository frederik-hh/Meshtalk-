package com.meshtalk.app

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.WindowCompat

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Make the app edge-to-edge (optional, looks better)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        
        setContent {
            Surface(modifier = Modifier.fillMaxSize()) {
                WebViewScreen()
            }
        }
    }
}

@Composable
fun WebViewScreen() {
    val context = LocalContext.current
    
    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    allowFileAccess = true
                    allowFileAccessFromFileURLs = true
                    allowUniversalAccessFromFileURLs = true
                    setSupportZoom(true)
                    builtInZoomControls = true
                    displayZoomControls = false
                }
                webViewClient = WebViewClient()
                webChromeClient = WebChromeClient() // needed for some WebRTC features
                
                // Load your PWA from the assets folder
                // This assumes your built PWA files are in android/app/src/main/assets/
                loadUrl("file:///android_asset/index.html")
            }
        },
        modifier = Modifier.fillMaxSize()
    )
}