package io.runonflux.sspkey

import android.app.ActivityManager
import android.os.Build
import android.os.Bundle
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
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
        applySecurityFeatures()
    }

    override fun onResume() {
        super.onResume()
        if (isOverlayEnabled(this)) {
            warnAndBlockUser()
        } else {
            allowUserInteraction()
        }
    }

    private fun applySecurityFeatures() {
        // Block screenshots & screen recording
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        // Prevent tapjacking by filtering touch events
        enforceTapjackingProtection(findViewById(android.R.id.content))
    }

    private fun enforceTapjackingProtection(view: View?) {
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                enforceTapjackingProtection(view.getChildAt(i))
            }
        }
        view?.filterTouchesWhenObscured = true // Prevent touches if obscured by overlay
    }

    private fun isOverlayEnabled(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return Settings.canDrawOverlays(context)
        }
        return false
    }

    private fun warnAndBlockUser() {
        Toast.makeText(this, "Security warning: Screen overlays detected! Please disable them.", Toast.LENGTH_LONG).show()
        // Fully block user interaction when an overlay is active
        window.setFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE, WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
    }

    private fun allowUserInteraction() {
        // Restore user interaction
        window.clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (event.flags and MotionEvent.FLAG_WINDOW_IS_OBSCURED != 0) {
                Toast.makeText(this, "Security alert: Touch ignored due to screen overlay.", Toast.LENGTH_SHORT).show()
                return false
            }
        }
        return super.dispatchTouchEvent(event)
    }
}
