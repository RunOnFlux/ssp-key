package io.runonflux.sspkey

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityWindowInfo

class OverlayDetectionService : AccessibilityService() {

    private val handler = Handler(Looper.getMainLooper())
    private var lastOverlayCheckTime: Long = 0
    private var overlayDetected = false

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOWS_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                handler.postDelayed({
                    checkForOverlays()
                }, 500) // Small delay to filter out transient UI updates
            }
        }
    }

    override fun onInterrupt() {
        Log.d("OverlayDetectionService", "Service interrupted")
    }

    private fun checkForOverlays() {
        if (isOverlayActive(this)) {
            if (!overlayDetected) {
                Log.w("OverlayDetectionService", "⚠️ Persistent overlay detected!")
                overlayDetected = true
            }
        } else {
            overlayDetected = false
            Log.d("OverlayDetectionService", "✅ No overlays detected.")
        }
        lastOverlayCheckTime = System.currentTimeMillis()
    }

    companion object {
        fun isOverlayActive(context: Context): Boolean {
            val accessibilityManager =
                context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
                    ?: return false

            // 🔹 1. Check if SYSTEM_ALERT_WINDOW is actively displaying overlays
            if (Settings.canDrawOverlays(context)) {
                val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                val overlayParams = WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                    android.graphics.PixelFormat.TRANSLUCENT
                )

                try {
                    val overlayView = android.view.View(context)
                    windowManager.addView(overlayView, overlayParams)
                    windowManager.removeView(overlayView)
                } catch (e: Exception) {
                    Log.w("OverlayDetectionService", "⚠️ Active overlay detected via WindowManager!")
                    return true
                }
            }

            // 🔹 2. Check accessibility overlays (ignoring our own service)
            val enabledServices = accessibilityManager.getEnabledAccessibilityServiceList(
                AccessibilityServiceInfo.FEEDBACK_ALL_MASK
            )

            val packageName = context.packageName // Get this app's package name
            for (service in enabledServices) {
                val serviceInfo = service.resolveInfo.serviceInfo
                val serviceName = serviceInfo.name
                val servicePackage = serviceInfo.packageName

                // ✅ Ignore our own service
                if (servicePackage == packageName) {
                    Log.d("OverlayDetectionService", "Ignoring our own accessibility service: $serviceName")
                    continue
                }

                Log.w("OverlayDetectionService", "⚠️ Accessibility overlay detected from $servicePackage!")
                return true
            }

            // 🔹 3. Check for toast overlays specifically
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP_MR1) {
                val service = context.getSystemService(AccessibilityService::class.java)
                val windows = service?.windows ?: emptyList()

                for (window in windows) {
                    val windowType = window.type

                    // ✅ Ignore system UI like status bar, navigation bar, and app dialogs
                    if (windowType == AccessibilityWindowInfo.TYPE_SYSTEM ||
                        windowType == AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY) {
                        continue
                    }

                    // ✅ Detect Toast overlays
                    if (windowType == WindowManager.LayoutParams.TYPE_TOAST) {
                        Log.w("OverlayDetectionService", "⚠️ Toast overlay detected!")
                        return true
                    }

                    // ✅ Flag suspicious floating overlays
                    if (window.layer > WindowManager.LayoutParams.LAST_SUB_WINDOW) {
                        Log.w("OverlayDetectionService", "⚠️ Floating overlay detected!")
                        return true
                    }
                }
            }

            return false
        }
    }
}
