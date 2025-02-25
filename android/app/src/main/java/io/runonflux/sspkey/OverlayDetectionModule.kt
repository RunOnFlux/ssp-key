package io.runonflux.sspkey

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Callback

class OverlayDetectionModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "OverlayDetectionModule"
    }

    @ReactMethod
    fun checkForOverlays(callback: Callback) {
        val hasOverlay = OverlayDetectionService.isOverlayActive(reactApplicationContext.applicationContext)
        callback.invoke(hasOverlay)
    }
}
