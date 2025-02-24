package io.runonflux.sspkey

import android.os.Bundle
import android.view.WindowManager
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
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
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )

        // Start Accessibility Service for overlay detection
        startOverlayDetectionService()
    }

    override fun onResume() {
        super.onResume()

        // Check if overlays are detected
        if (OverlayDetectionService.isOverlayActive(applicationContext)) {
            disableUserInteraction()
            showOverlayWarning()
        } else {
            enableUserInteraction()
        }
    }

    private fun startOverlayDetectionService() {
        val intent = Intent(this, OverlayDetectionService::class.java)
        startService(intent)
    }

    private fun disableUserInteraction() {
        window.setFlags(
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        )
    }

    private fun enableUserInteraction() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
    }

private fun showOverlayWarning() {
    val alertDialog = AlertDialog.Builder(this)
        .setTitle("Security Warning")
        .setMessage("⚠️ Overlays detected! Please disable them in settings.")
        .setCancelable(false)
        .setPositiveButton("Open Settings") { dialog, _ ->
            dialog.dismiss()
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
            startActivity(intent)
        }
        .setNegativeButton("Ignore") { dialog, _ -> dialog.dismiss() }
        .create()
    alertDialog.show()
}
}
