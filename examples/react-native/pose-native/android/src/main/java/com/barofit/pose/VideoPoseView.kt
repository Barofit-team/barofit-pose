package com.barofit.pose

import android.graphics.*
import android.media.MediaPlayer
import android.net.Uri
import android.os.SystemClock
import android.view.*
import android.widget.FrameLayout
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
import kotlin.math.min

/** Decode/play at original speed. Infer the currently displayed frame, never pre-render a video. */
class VideoPoseView(private val react:ThemedReactContext):NativeCameraLayout(react),LifecycleEventListener,TextureView.SurfaceTextureListener{
    private val content=FitVideo(react)
    private val texture=TextureView(react)
    private val overlay=Skeleton(react)
    private val executor=Executors.newSingleThreadExecutor()
    private var player:MediaPlayer?=null
    private var surface:Surface?=null
    private var detector:PoseLandmarker?=null
    private var uri:String?=null
    private var prepared=false
    @Volatile private var disposed=false
    @Volatile private var busy=false
    private var lastFrame=0L
    private var frameId=0
    private var generation=0
    private var ended=false
    private var finishPending=false
    private var startMs=0
    private var endMs=0
    @Volatile var active=false
        set(value){field=value;post{keepScreenOn=value;if(prepared){if(value&&!ended)player?.start() else player?.pause()}}}
    init{setBackgroundColor(Color.BLACK);content.addView(texture);content.addView(overlay);addView(content,LayoutParams(-1,-1));texture.surfaceTextureListener=this;react.addLifecycleEventListener(this)}
    fun setUri(value:String?){if(uri==value)return;uri=value;generation++;releasePlayer();if(texture.isAvailable)prepare()}
    fun setStart(value:Double){startMs=value.toInt().coerceAtLeast(0);if(prepared&&!active)player?.seekTo(startMs.toLong(),MediaPlayer.SEEK_CLOSEST)}
    fun setEnd(value:Double){endMs=value.toInt().coerceAtLeast(0)}
    fun setSide(value:String?){overlay.side=value;overlay.invalidate()}
    private fun emit(name:String,map:WritableMap){post{if(!disposed&&id!=View.NO_ID)UIManagerHelper.getEventDispatcherForReactTag(react,id)?.dispatchEvent(VideoPoseEvent(UIManagerHelper.getSurfaceId(this),id,name,map))}}
    private fun status(code:String,message:String){emit("topCameraStatus",Arguments.createMap().apply{putString("code",code);putString("message",message);putInt("positionMs",player?.currentPosition?:0);putInt("durationMs",player?.duration?.coerceAtLeast(0)?:0);putString("inputMode","video")})}
    private fun error(message:String){active=false;emit("topPoseError",Arguments.createMap().apply{putString("message",message)})}
    private fun prepare(){
        if(disposed||uri==null||player!=null||!texture.isAvailable)return
        try{surface=Surface(texture.surfaceTexture);val m=MediaPlayer();player=m;val gen=generation;m.setSurface(surface);m.setDataSource(react,Uri.parse(uri));m.setVolume(0f,0f)
            m.setOnPreparedListener{
                if(gen!=generation||disposed)return@setOnPreparedListener
                prepared=true;ended=false;content.videoWidth=m.videoWidth;content.videoHeight=m.videoHeight;content.requestLayout();layoutNativeChildren()
                val start=startMs.coerceAtMost((m.duration-100).coerceAtLeast(0));m.seekTo(start.toLong(),MediaPlayer.SEEK_CLOSEST)
                m.setOnSeekCompleteListener{status("streaming","저장 영상 준비 완료 · 1배속 분석");if(active)m.start();m.setOnSeekCompleteListener(null)}
            }
            m.setOnCompletionListener{completePlayback()};m.setOnErrorListener{_,what,extra->error("영상 재생 오류 ($what/$extra). MP4(H.264) 영상을 선택해 주세요.");true};m.prepareAsync()
        }catch(e:Exception){error(e.message?:"영상을 열 수 없어요.")}
    }
    private fun completePlayback(){if(ended)return;player?.pause();finishPending=true;if(!busy)endEvent()}
    private fun endEvent(){if(ended)return;ended=true;finishPending=false;active=false;status("video_ended","영상 분석이 끝났어요.")}
    override fun onSurfaceTextureAvailable(s:SurfaceTexture,w:Int,h:Int){prepare()}
    override fun onSurfaceTextureSizeChanged(s:SurfaceTexture,w:Int,h:Int){}
    override fun onSurfaceTextureDestroyed(s:SurfaceTexture):Boolean{generation++;releasePlayer();return true}
    override fun onSurfaceTextureUpdated(s:SurfaceTexture){
        if(!active||disposed||!prepared||busy||ended)return
        val m=player?:return;val position=m.currentPosition
        if(endMs>0&&position>=endMs){completePlayback();return}
        val now=SystemClock.elapsedRealtime();if(now-lastFrame<67)return;lastFrame=now
        val w=min(640,m.videoWidth);val h=(w.toDouble()*m.videoHeight/m.videoWidth.coerceAtLeast(1)).toInt().coerceAtLeast(1)
        val bitmap=texture.getBitmap(w,h)?:return;busy=true;val gen=generation;val received=System.currentTimeMillis();val frame=++frameId
        executor.execute{
            try{
                if(detector==null)detector=PoseLandmarker.createFromOptions(react,PoseLandmarker.PoseLandmarkerOptions.builder()
                    .setBaseOptions(BaseOptions.builder().setModelAssetPath("pose_landmarker_full.task").setDelegate(Delegate.CPU).build())
                    .setRunningMode(RunningMode.VIDEO).setNumPoses(1).setMinPoseDetectionConfidence(.5f).setMinPosePresenceConfidence(.5f).setMinTrackingConfidence(.5f).build())
                val begin=SystemClock.elapsedRealtime();val input=BitmapImageBuilder(bitmap).build();val result=try{detector!!.detectForVideo(input,now)}finally{input.close()}
                val inference=SystemClock.elapsedRealtime()-begin;val points=result.landmarks().firstOrNull()?.map{p->floatArrayOf(p.x(),p.y(),p.z(),p.visibility().orElse(0f),p.presence().orElse(0f))}?:emptyList()
                val array=Arguments.createArray();for(p in points)array.pushArray(Arguments.createArray().apply{p.forEach{pushDouble(it.toDouble())}})
                post{
                    if(gen==generation&&!disposed){
                        overlay.points=points;overlay.imageWidth=w;overlay.imageHeight=h;overlay.mirrored=false;overlay.invalidate()
                        if(active||finishPending)emit("topPose",Arguments.createMap().apply{putDouble("timestampMs",now.toDouble());putDouble("analysisReceivedUnixMs",received.toDouble());putDouble("inferenceMs",inference.toDouble());putDouble("nativeElapsedMs",(SystemClock.elapsedRealtime()-now).toDouble());putInt("width",w);putInt("height",h);putInt("frameId",frame);putInt("videoPositionMs",position);putArray("landmarks",array)})
                    }
                    busy=false;if(finishPending&&!disposed)endEvent()
                }
            }catch(e:Exception){post{busy=false;error(e.message?:"영상 관절 추출 실패")}}
            finally{bitmap.recycle()}
        }
    }
    private fun releasePlayer(){prepared=false;player?.release();player=null;surface?.release();surface=null;overlay.points=emptyList();overlay.invalidate()}
    override fun onHostPause(){active=false}
    override fun onHostResume(){}
    override fun onHostDestroy(){dispose()}
    override fun onDetachedFromWindow(){generation++;releasePlayer();super.onDetachedFromWindow()}
    override fun onAttachedToWindow(){super.onAttachedToWindow();if(texture.isAvailable)prepare()}
    fun dispose(){if(disposed)return;disposed=true;active=false;generation++;releasePlayer();react.removeLifecycleEventListener(this);executor.execute{detector?.close();detector=null};executor.shutdown()}
}
private class FitVideo(context:android.content.Context):FrameLayout(context){
    var videoWidth=16;var videoHeight=9
    override fun onLayout(changed:Boolean,l:Int,t:Int,r:Int,b:Int){val scale=min(width.toDouble()/videoWidth.coerceAtLeast(1),height.toDouble()/videoHeight.coerceAtLeast(1));val w=(videoWidth*scale).toInt();val h=(videoHeight*scale).toInt();for(i in 0 until childCount)getChildAt(i).apply{measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY));layout((widthOfParent()-w)/2,(heightOfParent()-h)/2,(widthOfParent()+w)/2,(heightOfParent()+h)/2)}}
    private fun View.widthOfParent()=this@FitVideo.width
    private fun View.heightOfParent()=this@FitVideo.height
}
private class VideoPoseEvent(surfaceId:Int,viewId:Int,private val name:String,private val payload:WritableMap):Event<VideoPoseEvent>(surfaceId,viewId){override fun getEventName()=name;override fun getEventData()=payload;override fun canCoalesce()=name=="topPose"}
