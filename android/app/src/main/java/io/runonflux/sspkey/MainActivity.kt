package io.runonflux.sspkey

import android.app.ActivityManager
import android.os.Build
import android.os.Bundle
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
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

        // Apply tapjacking protection
        applyTapjackingProtection()

        // Retrieve the root view of the activity
        val rootView = findViewById<View>(android.R.id.content).rootView
        
        // Set the filterTouchesWhenObscured property to true
        rootView.filterTouchesWhenObscured = true

        // Block screenshots & overlays
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
    }

    override fun onResume() {
        super.onResume()

        // Apply tapjacking protection
        applyTapjackingProtection()

        // Detect active overlays and warn users
        if (isOverlayEnabled(this)) {
            Toast.makeText(this, "Warning: Screen overlays detected! Disable them for security.", Toast.LENGTH_LONG).show()

            // Block user interaction when overlay is active
            window.setFlags(
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
            )
        } else {
            // Re-enable user interaction if no overlays
            window.clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
        }
    }

    private fun applyTapjackingProtection() {
        val rootView = findViewById<View>(android.R.id.content)
        setFilterTouchesWhenObscured(rootView)

        // Prevent tapjacking by setting flags
        window.setFlags(
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        )
    }

    private fun setFilterTouchesWhenObscured(view: View?) {
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                setFilterTouchesWhenObscured(view.getChildAt(i))
            }
        }
        view?.filterTouchesWhenObscured = true
    }

    private fun isOverlayEnabled(context: Context): Boolean {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val runningServices = activityManager.runningAppProcesses
        for (process in runningServices) {
            if (process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                return Settings.canDrawOverlays(context) || process.processName.contains("system_alert_window")
            }
        }
        return false
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { // API 29+
            if (event.flags and MotionEvent.FLAG_WINDOW_IS_OBSCURED != 0) {
                Toast.makeText(this, "Touch ignored due to security overlay", Toast.LENGTH_SHORT).show()
                return false // Ignore the touch event
            }
        }
        return super.dispatchTouchEvent(event)
    }
}
