package io.runonflux.sspkey

import android.os.Bundle
import android.view.*
import android.provider.Settings
import android.widget.Toast
import android.content.Context
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "SSPKey"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Block screenshots & overlays
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        // Apply tapjacking protection to all views
        applyTapjackingProtection()
    }

    override fun onResume() {
        super.onResume()
        
        // Reapply tapjacking protection for newly added views
        applyTapjackingProtection()

        // Detect and handle overlays
        if (isOverlayEnabled()) {
            showOverlayWarning()
            disableTouchEvents()
        } else {
            enableTouchEvents()
        }
    }

    private fun applyTapjackingProtection() {
        val rootView = findViewById<View>(android.R.id.content)
        protectViewsFromTapjacking(rootView)
    }

    private fun protectViewsFromTapjacking(view: View?) {
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                protectViewsFromTapjacking(view.getChildAt(i))
            }
        }
        view?.filterTouchesWhenObscured = true
    }

    private fun isOverlayEnabled(): Boolean {
        return Settings.canDrawOverlays(this)
    }

    private fun showOverlayWarning() {
        Toast.makeText(this, "Security Warning: Screen overlays detected! Disable them to continue safely.", Toast.LENGTH_LONG).show()
    }

    private fun disableTouchEvents() {
        findViewById<View>(android.R.id.content)?.apply {
            isClickable = false
            isFocusable = false
            alpha = 0.5f  // Dim the screen to indicate disabled state
        }
    }

    private fun enableTouchEvents() {
        findViewById<View>(android.R.id.content)?.apply {
            isClickable = true
            isFocusable = true
            alpha = 1.0f  // Restore normal appearance
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        
        // If the app loses focus (e.g., an overlay appears), block interactions
        if (!hasFocus && isOverlayEnabled()) {
            showOverlayWarning()
            disableTouchEvents()
        } else {
            enableTouchEvents()
        }
    }
}
