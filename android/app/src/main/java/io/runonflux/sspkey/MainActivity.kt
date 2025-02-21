package io.runonflux.sspkey

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Toast
import android.content.Context
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    private val securityHandler = Handler(Looper.getMainLooper())

    override fun getMainComponentName(): String = "SSPKey"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Block screenshots & overlays
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        // Apply maximum tapjacking protection
        applyTapjackingProtection()

        // Start continuous overlay detection
        startOverlayDetection()
    }

    override fun onResume() {
        super.onResume()

        // Reapply tapjacking protection
        applyTapjackingProtection()

        // Handle overlays if detected
        handleOverlayDetection()
    }

    private fun applyTapjackingProtection() {
        val rootView = findViewById<View>(android.R.id.content)
        protectAllViews(rootView)
    }

    private fun protectAllViews(view: View?) {
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                protectAllViews(view.getChildAt(i))
            }
        }
        view?.filterTouchesWhenObscured = true
    }

    private fun isOverlayEnabled(): Boolean {
        return Settings.canDrawOverlays(this)
    }

    private fun handleOverlayDetection() {
        if (isOverlayEnabled() || detectHiddenOverlays()) {
            showOverlayWarning()
            disableTouchEvents()
        } else {
            enableTouchEvents()
        }
    }

    private fun detectHiddenOverlays(): Boolean {
        val accessibilityEnabled = Settings.Secure.getInt(
            contentResolver,
            Settings.Secure.ACCESSIBILITY_ENABLED,
            0
        )
        return accessibilityEnabled == 1
    }

    private fun showOverlayWarning() {
        Toast.makeText(this, "Security Warning: Screen overlays detected! Disable them for maximum security.", Toast.LENGTH_LONG).show()
    }

    private fun disableTouchEvents() {
        findViewById<View>(android.R.id.content)?.apply {
            isClickable = false
            isFocusable = false
            isEnabled = false
            alpha = 0.5f  // Dim screen as a warning
        }
    }

    private fun enableTouchEvents() {
        findViewById<View>(android.R.id.content)?.apply {
            isClickable = true
            isFocusable = true
            isEnabled = true
            alpha = 1.0f
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)

        if (!hasFocus && isOverlayEnabled()) {
            showOverlayWarning()
            disableTouchEvents()
        } else {
            enableTouchEvents()
        }
    }

    private fun startOverlayDetection() {
        securityHandler.postDelayed(object : Runnable {
            override fun run() {
                handleOverlayDetection()
                securityHandler.postDelayed(this, 2000) // Check every 2 seconds
            }
        }, 2000)
    }

    override fun onDestroy() {
        super.onDestroy()
        securityHandler.removeCallbacksAndMessages(null)
    }
}
