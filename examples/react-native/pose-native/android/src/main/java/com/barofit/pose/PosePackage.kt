package com.barofit.pose

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.*
import com.facebook.react.uimanager.annotations.ReactProp
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.UUID
import java.util.Locale

class PosePackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PoseVoice(context),PoseDiagnostics(context),PoseMedia(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = listOf(PoseViewManager(),VideoPoseViewManager())
}
class PoseViewManager : SimpleViewManager<PoseView>() {
    override fun getName() = "BarofitPoseView"
    override fun createViewInstance(context: ThemedReactContext) = PoseView(context)
    @ReactProp(name = "active", defaultBoolean = false)
    fun setActive(view: PoseView, value: Boolean) { view.active = value }
    @ReactProp(name = "frontCamera", defaultBoolean = false)
    fun setFront(view: PoseView, value: Boolean) { view.setFrontCamera(value) }
    @ReactProp(name = "selectedSide")
    fun setSelectedSide(view: PoseView, value: String?) { view.setSelectedSide(value) }
    override fun onDropViewInstance(view: PoseView) { view.dispose(); super.onDropViewInstance(view) }
    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> = mutableMapOf(
        "topPose" to mapOf("registrationName" to "onPose"),
        "topPoseError" to mapOf("registrationName" to "onPoseError"),
        "topCameraStatus" to mapOf("registrationName" to "onCameraStatus")
    )
}
class PoseVoice(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    @Volatile private var ready = false
    private val speechLock = Any()
    private var activeUtterance: String? = null
    private fun complete(id: String?) { synchronized(speechLock) { if (activeUtterance == id) activeUtterance = null } }
    private var tts: TextToSpeech? = null
    init { tts = TextToSpeech(context) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (ready) {
            ready = (tts?.setLanguage(Locale.KOREAN) ?: TextToSpeech.LANG_NOT_SUPPORTED) >= 0
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { complete(utteranceId) }
                @Deprecated("Legacy callback")
                override fun onError(utteranceId: String?) { complete(utteranceId) }
                override fun onError(utteranceId: String?, errorCode: Int) { complete(utteranceId) }
                override fun onStop(utteranceId: String?, interrupted: Boolean) { complete(utteranceId) }
            })
        }
    } }
    override fun getName() = "BarofitPoseVoice"
    @ReactMethod fun speakIfIdle(text: String, promise: Promise) {
        synchronized(speechLock) {
            if (!ready || activeUtterance != null) { promise.resolve(false); return }
            val id = UUID.randomUUID().toString()
            activeUtterance = id
            val result = tts?.speak(text, TextToSpeech.QUEUE_ADD, null, id)
            if (result != TextToSpeech.SUCCESS) { activeUtterance = null; promise.resolve(false); return }
            promise.resolve(true)
        }
    }
    @ReactMethod fun stop() { synchronized(speechLock) { tts?.stop(); activeUtterance = null } }
    @ReactMethod fun status(promise: Promise) { promise.resolve(ready) }
    override fun invalidate() { tts?.stop(); tts?.shutdown(); tts = null; super.invalidate() }
}

class VideoPoseViewManager: SimpleViewManager<VideoPoseView>() {
    override fun getName()="BarofitVideoPoseView"
    override fun createViewInstance(context:ThemedReactContext)=VideoPoseView(context)
    @ReactProp(name="active",defaultBoolean=false) fun setActive(view:VideoPoseView,value:Boolean){view.active=value}
    @ReactProp(name="videoUri") fun setUri(view:VideoPoseView,value:String?){view.setUri(value)}
    @ReactProp(name="startMs",defaultDouble=0.0) fun setStart(view:VideoPoseView,value:Double){view.setStart(value)}
    @ReactProp(name="endMs",defaultDouble=0.0) fun setEnd(view:VideoPoseView,value:Double){view.setEnd(value)}
    @ReactProp(name="selectedSide") fun setSide(view:VideoPoseView,value:String?){view.setSide(value)}
    override fun onDropViewInstance(view:VideoPoseView){view.dispose();super.onDropViewInstance(view)}
    override fun getExportedCustomDirectEventTypeConstants():MutableMap<String,Any> = mutableMapOf(
        "topPose" to mapOf("registrationName" to "onPose"),"topPoseError" to mapOf("registrationName" to "onPoseError"),"topCameraStatus" to mapOf("registrationName" to "onCameraStatus"))
}
