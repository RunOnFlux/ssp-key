package io.runonflux.sspkey

import android.os.Bundle
import android.view.WindowManager
import android.provider.Settings
import android.widget.Toast
import android.content.Context
import android.view.View
import android.view.ViewGroup
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

        // Apply tapjacking protection
        applyTapjackingProtection()
    }

    override fun onResume() {
        super.onResume()
        
        // Reapply tapjacking protection (if new views are added dynamically)
        applyTapjackingProtection()

        // Warn user if overlays are detected
        if (Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Warning: Screen overlays detected! Disable them for security.", Toast.LENGTH_LONG).show()
        }
    }

    private fun applyTapjackingProtection() {
        val rootView = findViewById<View>(android.R.id.content)
        setFilterTouchesWhenObscured(rootView)
    }

    private fun setFilterTouchesWhenObscured(view: View?) {
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                setFilterTouchesWhenObscured(view.getChildAt(i))
            }
        }
        view?.filterTouchesWhenObscured = true
    }
}
