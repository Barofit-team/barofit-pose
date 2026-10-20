package com.barofit.pose

import android.app.Activity
import android.content.Intent
import android.content.ClipData
import android.os.Build
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONObject

class PoseDiagnostics(private val context: ReactApplicationContext): ReactContextBaseJavaModule(context) {
    private val io=Executors.newSingleThreadExecutor()
    private val store=DiagnosticStore(File(context.filesDir,"pose-tests"))
    private var pending: Pair<File,Promise>?=null
    private val listener=object: BaseActivityEventListener(){
        override fun onActivityResult(activity: Activity,requestCode: Int,resultCode: Int,data: Intent?){
            if(requestCode!=8732)return
            val job=pending?:return;pending=null
            if(resultCode!=Activity.RESULT_OK||data?.data==null){job.second.resolve("cancelled");return}
            val uri=data.data!!
            io.execute {
                try { context.contentResolver.openOutputStream(uri,"w")!!.use { dst->job.first.inputStream().use { it.copyTo(dst) } };job.second.resolve("saved") }
                catch(e:Exception){job.second.reject("SAVE_FAILED",e)}
            }
        }
    }
    init{context.addActivityEventListener(listener)}
    override fun getName()="BarofitPoseDiagnostics"
    private fun task(p:Promise,body:()->Any?){io.execute{try{p.resolve(body())}catch(e:Exception){p.reject("LOG_IO",e)}}}
    @ReactMethod fun beginSession(id:String,metadata:String,p:Promise)=task(p){
        val m=JSONObject(metadata).put("device",JSONObject().put("manufacturer",Build.MANUFACTURER).put("model",Build.MODEL).put("android_api",Build.VERSION.SDK_INT))
            .put("pose_model","pose_landmarker_full.task").put("delegate","CPU").put("pose_model_sha256","5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1")
        store.begin(id,m.toString(2));id
    }
    @ReactMethod fun appendRecords(id:String,records:String,p:Promise)=task(p){store.append(id,records);true}
    @ReactMethod fun writeSummary(id:String,summary:String,p:Promise)=task(p){store.summary(id,summary);true}
    @ReactMethod fun writeServiceResult(id:String,result:String,p:Promise)=task(p){JSONObject(result);File(store.directory(id),"set_result.json").writeText(result,Charsets.UTF_8);true}
    @ReactMethod fun listSessions(p:Promise)=task(p){Arguments.createArray().apply{for(dir in store.list())pushMap(Arguments.createMap().apply{
        putString("id",dir.name);putDouble("bytes",dir.listFiles()?.sumOf{it.length()}?.toDouble()?:0.0)
        val meta=JSONObject(File(dir,"metadata.json").readText());putString("created_at",meta.optString("created_at"))
        val file=File(dir,"summary.json");val s=if(file.exists())JSONObject(file.readText())else JSONObject()
        putBoolean("complete",s.optBoolean("complete",false));putInt("count",s.optInt("count",0))
    })}}
    @ReactMethod fun exportSession(id:String,action:String,p:Promise){
        io.execute{
            try{
                require(action=="save"||action=="share")
                val zip=store.export(id,File(context.filesDir,"pose-exports"))
                UiThreadUtil.runOnUiThread{
                    try{
                        val activity=context.currentActivity?:throw IllegalStateException("화면으로 돌아온 뒤 다시 시도해 주세요.")
                        if(action=="save"){
                            check(pending==null){"저장 창이 이미 열려 있어요."};pending=zip to p
                            try{activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply{
                                addCategory(Intent.CATEGORY_OPENABLE);type="application/zip";putExtra(Intent.EXTRA_TITLE,zip.name)
                            },8732)}catch(e:Exception){pending=null;throw e}
                        }else{
                            val uri=FileProvider.getUriForFile(context,context.packageName+".poseexports",zip)
                            val intent=Intent(Intent.ACTION_SEND).apply{type="application/zip";putExtra(Intent.EXTRA_STREAM,uri)
                                clipData=ClipData.newRawUri("운동 검증 로그",uri);addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)}
                            activity.startActivity(Intent.createChooser(intent,"검증 로그 ZIP 공유"));p.resolve("share_opened")
                        }
                    }catch(e:Exception){p.reject("EXPORT_UI",e)}
                }
            }catch(e:Exception){p.reject("EXPORT_FAILED",e)}
        }
    }
    override fun invalidate(){context.removeActivityEventListener(listener);pending?.second?.reject("CLOSED","앱이 종료됐어요.");pending=null;io.shutdown();super.invalidate()}
}
