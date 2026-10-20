package com.barofit.pose

import android.graphics.*
import android.os.SystemClock
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import android.util.Size
import android.view.View
import android.widget.FrameLayout
import androidx.camera.core.*
import androidx.camera.core.Camera
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import java.util.concurrent.Executors
import java.nio.ByteBuffer
import kotlin.math.min

/** Prototype native ViewManager adapter. Camera frames never cross the RN/network bridge. */
class PoseView(private val react: ThemedReactContext) : NativeCameraLayout(react), LifecycleEventListener {
    @Volatile var active = false
        set(value) { field = value; post { keepScreenOn = value; if (value && attached) startCamera() } }
    private var front = false
    @Volatile private var disposed = false
    private val executor = Executors.newSingleThreadExecutor()
    private val preview = PreviewView(react)
    private val overlay = Skeleton(react)
    private var provider: ProcessCameraProvider? = null
    private var previewUseCase: Preview? = null
    private var analysis: ImageAnalysis? = null
    private var detector: PoseLandmarker? = null
    private var lastFrame = -1L
    private var failed = false
    private var attached = false
    private var binding = false
    private var bindGeneration = 0
    private var observerOwner: LifecycleOwner? = null
    private var boundCamera: Camera? = null
    @Volatile private var cameraFrames = 0
    private val previewWatchdog = Runnable {
        if (attached && analysis != null && preview.previewStreamState.value != PreviewView.StreamState.STREAMING) {
            status("preview_waiting", "카메라 미리보기가 시작되지 않았어요. 다시 연결을 눌러 주세요.")
        }
    }
    init {
        preview.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        preview.scaleType = PreviewView.ScaleType.FIT_CENTER
        addView(preview, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(overlay, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        react.addLifecycleEventListener(this)
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); attached = true; startCamera() }
    override fun onDetachedFromWindow() { attached = false; stopCamera(); super.onDetachedFromWindow() }
    override fun onHostResume() { if (attached) startCamera() }
    override fun onHostPause() { active = false; stopCamera() }
    override fun onHostDestroy() { dispose() }
    fun setFrontCamera(value: Boolean) { if (front != value) { front = value; if (attached) { stopCamera(); startCamera() } } }
    fun setSelectedSide(value: String?) { overlay.side = value;overlay.invalidate() }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w,h,oldw,oldh)
        display?.rotation?.let { analysis?.targetRotation = it; previewUseCase?.targetRotation = it }
        if (attached && w > 0 && h > 0) post { startCamera() }
    }
    private fun emit(name: String, map: WritableMap) {
        post { if (!disposed && id != View.NO_ID) UIManagerHelper.getEventDispatcherForReactTag(react,id)
            ?.dispatchEvent(PoseEvent(UIManagerHelper.getSurfaceId(this),id,name,map)) }
    }
    private fun error(message: String) { emit("topPoseError", Arguments.createMap().apply { putString("message",message) }) }
    private fun status(code: String, message: String) {
        emit("topCameraStatus", Arguments.createMap().apply {
            putString("code",code);putString("message",message)
            putInt("viewWidth",width);putInt("viewHeight",height)
            putInt("previewWidth",preview.width);putInt("previewHeight",preview.height)
            putInt("cameraFrames",cameraFrames)
            putString("device",Build.MANUFACTURER+" "+Build.MODEL)
            putInt("androidApi",Build.VERSION.SDK_INT)
        })
    }
    private fun startCamera() {
        if (disposed || analysis != null || binding || !attached) return
        if (width <= 0 || height <= 0) { status("waiting_layout","카메라 화면을 준비하고 있어요."); return }
        if (ContextCompat.checkSelfPermission(react,Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            error("카메라 권한을 허용한 뒤 다시 시작해 주세요."); return
        }
        layoutNativeChildren()
        binding = true
        val generation = ++bindGeneration
        status("connecting","카메라 연결 중이에요.")
        val future = ProcessCameraProvider.getInstance(react)
        future.addListener({
            if (generation != bindGeneration) return@addListener
            binding = false
            if (disposed || !attached || analysis != null) return@addListener
            try {
                val owner = react.currentActivity as? LifecycleOwner ?: throw IllegalStateException("Activity must implement LifecycleOwner")
                provider = future.get()
                val p = Preview.Builder().setTargetResolution(Size(640,360)).build()
                p.setSurfaceProvider(ContextCompat.getMainExecutor(react),preview.surfaceProvider)
                val a = ImageAnalysis.Builder().setTargetResolution(Size(640,360))
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                display?.rotation?.let { a.targetRotation = it; p.targetRotation = it }
                a.setAnalyzer(executor) { frame -> analyze(frame) }
                val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
                if (provider?.hasCamera(selector) != true) throw IllegalStateException("선택한 카메라를 사용할 수 없어요. 전면/후면 설정을 바꿔 주세요.")
                val camera = provider!!.bindToLifecycle(owner,selector,p,a)
                previewUseCase = p; analysis = a
                boundCamera = camera; observerOwner = owner; cameraFrames = 0
                preview.previewStreamState.observe(owner) { state ->
                    if (state == PreviewView.StreamState.STREAMING) {
                        removeCallbacks(previewWatchdog);status("streaming","카메라 화면이 연결됐어요.")
                    }
                }
                camera.cameraInfo.cameraState.observe(owner) { state ->
                    state.error?.let { error("카메라 연결 오류 ("+it.code+"). 카메라 다시 연결을 눌러 주세요.") }
                }
                requestLayout()
                postDelayed(previewWatchdog,8000)
            } catch (e: Exception) { error(e.message ?: "Camera initialization failed") }
        },ContextCompat.getMainExecutor(react))
    }
    private fun stopCamera() {
        bindGeneration++;binding = false;removeCallbacks(previewWatchdog)
        observerOwner?.let { owner ->
            preview.previewStreamState.removeObservers(owner)
            boundCamera?.cameraInfo?.cameraState?.removeObservers(owner)
        }
        observerOwner = null;boundCamera = null
        analysis?.clearAnalyzer()
        analysis?.let { provider?.unbind(it) };previewUseCase?.let { provider?.unbind(it) }
        analysis = null;previewUseCase = null
        overlay.points = emptyList();overlay.invalidate()
    }
    private fun analyze(frame: ImageProxy) {
        cameraFrames++
        if (cameraFrames == 1) status("frames_received","카메라 영상을 받고 있어요.")
        if (disposed || !active || failed) { frame.close(); return }
        val now = SystemClock.elapsedRealtime()
        if (lastFrame >= 0 && now-lastFrame < 67) { frame.close(); return }
        lastFrame = now
        val receivedUnixMs = System.currentTimeMillis()
        var bitmap: Bitmap? = null
        var rotated: Bitmap? = null
        try {
            if (detector == null) detector = PoseLandmarker.createFromOptions(react,
                PoseLandmarker.PoseLandmarkerOptions.builder()
                    .setBaseOptions(BaseOptions.builder().setModelAssetPath("pose_landmarker_full.task").setDelegate(Delegate.CPU).build())
                    .setRunningMode(RunningMode.VIDEO).setNumPoses(1)
                    .setMinPoseDetectionConfidence(.5f).setMinPosePresenceConfidence(.5f).setMinTrackingConfidence(.5f).build())
            val rotation = frame.imageInfo.rotationDegrees
            val plane = frame.planes[0]
            if (plane.pixelStride != 4) throw IllegalStateException("Expected CameraX RGBA frame")
            // Row padding is not guaranteed to exist after the final row.
            val packed = ByteBuffer.allocate(frame.width*frame.height*4)
            val source = plane.buffer.duplicate()
            val row = ByteArray(frame.width*4)
            for (y in 0 until frame.height) {
                source.position(y*plane.rowStride);source.get(row);packed.put(row)
            }
            packed.rewind()
            bitmap = Bitmap.createBitmap(frame.width,frame.height,Bitmap.Config.ARGB_8888)
            bitmap.copyPixelsFromBuffer(packed)
            // Use unmirrored image coordinates for inference; mirror only the front preview overlay.
            rotated = Bitmap.createBitmap(bitmap,0,0,frame.width,frame.height,Matrix().apply { postRotate(rotation.toFloat()) },true)
            val width = rotated.width;val height = rotated.height
            val start = SystemClock.elapsedRealtime()
            val input = BitmapImageBuilder(rotated).build()
            val result = try { detector!!.detectForVideo(input,now) } finally { input.close() }
            val inferenceMs = SystemClock.elapsedRealtime()-start
            val points = result.landmarks().firstOrNull()?.map { p -> floatArrayOf(p.x(),p.y(),p.z(),p.visibility().orElse(0f),p.presence().orElse(0f)) } ?: emptyList()
            val array = Arguments.createArray()
            for (p in points) array.pushArray(Arguments.createArray().apply { p.forEach { pushDouble(it.toDouble()) } })
            val payload = Arguments.createMap().apply {
                putDouble("timestampMs",now.toDouble());putDouble("analysisReceivedUnixMs",receivedUnixMs.toDouble())
                putDouble("inferenceMs",inferenceMs.toDouble());putDouble("nativeElapsedMs",(SystemClock.elapsedRealtime()-now).toDouble())
                putInt("width",width);putInt("height",height);putArray("landmarks",array)
                putInt("frameId",cameraFrames)
            }
            post { if (!disposed) { overlay.points = points;overlay.imageWidth = width;overlay.imageHeight = height;overlay.mirrored = front;overlay.invalidate() } }
            if (active) emit("topPose",payload)
        } catch (e: Exception) { failed = true;error(e.message ?: "Pose inference failed") }
        finally { frame.close();if (rotated !== bitmap) rotated?.recycle();bitmap?.recycle() }
    }
    fun dispose() {
        if (disposed) return
        disposed = true;active = false;stopCamera();react.removeLifecycleEventListener(this)
        executor.execute { detector?.close();detector = null };executor.shutdown()
    }
}

private class PoseEvent(surfaceId: Int, viewId: Int, private val name: String, private val payload: WritableMap)
    : Event<PoseEvent>(surfaceId,viewId) {
    override fun getEventName() = name
    override fun getEventData() = payload
    override fun canCoalesce() = name == "topPose"
}

internal class Skeleton(context: android.content.Context) : View(context) {
    var side: String? = null
    var points: List<FloatArray> = emptyList();var imageWidth = 1;var imageHeight = 1;var mirrored = false
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.CYAN;strokeWidth = 5f }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas);if(side!="left"&&side!="right")return
        val scale = min(width.toFloat()/imageWidth,height.toFloat()/imageHeight)
        val dx = (width-imageWidth*scale)/2;val dy = (height-imageHeight*scale)/2
        fun point(i: Int): PointF? {
            val p = points.getOrNull(i) ?: return null
            if (p[3]<.5 || p[4]<.5 || p[0] !in 0f..1f || p[1] !in 0f..1f) return null
            return PointF(dx+(if (mirrored) 1-p[0] else p[0])*imageWidth*scale,dy+p[1]*imageHeight*scale)
        }
        val edges = if(side=="left")listOf(11 to 13,13 to 15,11 to 23,23 to 27,11 to 27) else listOf(12 to 14,14 to 16,12 to 24,24 to 28,12 to 28)
        for ((a,b) in edges) { val p = point(a);val q = point(b);if (p!=null && q!=null) canvas.drawLine(p.x,p.y,q.x,q.y,paint) }
        for (i in (if(side=="left")listOf(11,13,15,23,27)else listOf(12,14,16,24,28))) point(i)?.let { canvas.drawCircle(it.x,it.y,7f,paint) }
    }
}
