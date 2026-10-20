package com.barofit.pose

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaCodec
import com.facebook.react.bridge.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executors

/** User-selected local media only. No upload or broad storage access. */
class PoseMedia(private val context: ReactApplicationContext): ReactContextBaseJavaModule(context) {
    private var pending: Promise?=null
    private val io=Executors.newSingleThreadExecutor()
    private val listener=object:BaseActivityEventListener(){
        override fun onActivityResult(activity:Activity,requestCode:Int,resultCode:Int,data:Intent?){
            if(requestCode!=8733)return
            val p=pending?:return;pending=null
            if(resultCode!=Activity.RESULT_OK||data?.data==null){p.resolve(null);return}
            val uri=data.data!!
            try{
                try{context.contentResolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION)}catch(_:Exception){}
                var name="선택한 영상"
                context.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{if(it.moveToFirst())name=it.getString(0)}
                p.resolve(Arguments.createMap().apply{putString("uri",uri.toString());putString("name",name)})
            }catch(e:Exception){p.reject("VIDEO_PICK",e)}
        }
    }
    init{context.addActivityEventListener(listener)}
    override fun getName()="BarofitPoseMedia"
    @ReactMethod fun pickVideo(p:Promise){UiThreadUtil.runOnUiThread{
        try{check(pending==null){"영상 선택 창이 이미 열려 있어요."};val activity=context.currentActivity?:throw IllegalStateException("앱 화면으로 돌아와 주세요.")
            pending=p;activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply{addCategory(Intent.CATEGORY_OPENABLE);type="video/*";addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)},8733)
        }catch(e:Exception){pending=null;p.reject("VIDEO_PICK",e)}
    }}
    @ReactMethod fun makeClips(uri:String,id:String,specs:String,p:Promise){io.execute{
        try{
            val dir=DiagnosticStore(File(context.filesDir,"pose-tests")).directory(id)
            check(File(dir,"metadata.json").isFile){"먼저 세트 결과를 저장해 주세요."}
            val requested=JSONArray(specs);require(requested.length()<=3)
            val manifest=JSONArray()
            for(i in 0 until requested.length()){
                val spec=requested.getJSONObject(i);val rep=spec.getInt("rep_id");require(rep in 1..100000)
                val start=spec.getLong("start_ms");val end=spec.getLong("end_ms");require(start>=0&&end>start&&end-start<=30000)
                val out=File(dir,"clip-rep-$rep.mp4")
                val actual=trim(Uri.parse(uri),out,start,end)
                manifest.put(JSONObject(spec.toString()).put("file_name",out.name).put("actual_start_ms",actual).put("size_bytes",out.length()).put("status","generated").put("audio",false).put("note","Starts at previous keyframe for decodable local MP4; no skeleton overlay."))
            }
            File(dir,"clip_manifest.json").writeText(manifest.toString(2),Charsets.UTF_8)
            p.resolve(manifest.toString())
        }catch(e:Exception){p.reject("CLIP_EXPORT",e)}
    }}
    private fun trim(uri:Uri,out:File,startMs:Long,endMs:Long):Long{
        val extractor=MediaExtractor();var muxer:MediaMuxer?=null;var started=false;var success=false
        try{
            extractor.setDataSource(context,uri,null)
            val track=(0 until extractor.trackCount).firstOrNull{extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/")==true}?:throw IllegalArgumentException("영상 트랙이 없어요.")
            val format=extractor.getTrackFormat(track);extractor.selectTrack(track);extractor.seekTo(startMs*1000,MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            val first=extractor.sampleTime;check(first>=0){"구간을 찾지 못했어요."}
            val m=MediaMuxer(out.absolutePath,MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);muxer=m
            if(format.containsKey(MediaFormat.KEY_ROTATION))m.setOrientationHint(format.getInteger(MediaFormat.KEY_ROTATION))
            val target=m.addTrack(format);m.start();started=true
            val size=if(format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE))format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 0
            val buffer=ByteBuffer.allocateDirect(maxOf(size,8*1024*1024));val info=MediaCodec.BufferInfo();var samples=0
            while(extractor.sampleTime>=0&&extractor.sampleTime<endMs*1000){buffer.clear();val n=extractor.readSampleData(buffer,0);if(n<0)break
                info.set(0,n,extractor.sampleTime-first,if(extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC!=0)MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                m.writeSampleData(target,buffer,info);samples++;extractor.advance()
            }
            check(samples>0){"빈 영상 구간이에요."};m.stop();started=false;success=true;return first/1000
        }finally{if(started)try{muxer?.stop()}catch(_:Exception){};muxer?.release();extractor.release();if(!success&&out.exists())out.delete()}
    }
    override fun invalidate(){context.removeActivityEventListener(listener);pending?.reject("CLOSED","앱이 종료됐어요.");pending=null;io.shutdown();super.invalidate()}
}
