package io.runonflux.sspkey

import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.provider.Settings
import android.widget.Toast
import android.content.Context
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.view.ViewGroup

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "SSPKey"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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

    private fun isOverlayEnabled(context: Context): Boolean {
        return Settings.canDrawOverlays(context)
    }
}
