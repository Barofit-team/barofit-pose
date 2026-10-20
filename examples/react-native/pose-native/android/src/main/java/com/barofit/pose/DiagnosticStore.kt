package com.barofit.pose

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.json.JSONObject

/** Called by one IO executor. Only explicitly named session files can be exported. */
class DiagnosticStore(private val root: File) {
    init { root.mkdirs() }
    fun directory(id: String): File {
        require(id.matches(Regex("[A-Za-z0-9-]{6,80}"))) { "Invalid session ID" }
        return File(root,id)
    }
    fun begin(id: String, metadata: String) {
        JSONObject(metadata)
        val dir=directory(id);check(!dir.exists()) { "Session already exists" };check(dir.mkdirs())
        File(dir,"metadata.json").writeText(metadata,Charsets.UTF_8)
        File(dir,"telemetry.jsonl").writeText("",Charsets.UTF_8)
    }
    fun append(id: String, records: String) {
        val dir=directory(id);check(File(dir,"metadata.json").exists()) { "Session not initialized" }
        File(dir,"telemetry.jsonl").appendText(records,Charsets.UTF_8)
    }
    fun summary(id: String, text: String) {
        JSONObject(text);val dir=directory(id);check(dir.exists())
        val file=android.util.AtomicFile(File(dir,"summary.json"));val stream=file.startWrite()
        try{stream.write(text.toByteArray(Charsets.UTF_8));file.finishWrite(stream)}catch(e:Exception){file.failWrite(stream);throw e}
    }
    fun list(): List<File> = root.listFiles()?.filter { it.isDirectory&&File(it,"metadata.json").isFile }?.sortedByDescending { it.name }?:emptyList()
    fun export(id: String, exports: File): File {
        val dir=directory(id);check(File(dir,"metadata.json").isFile)
        exports.mkdirs()
        val target=File(exports,"barofit-$id-${System.currentTimeMillis()}.zip")
        val csv=File(dir,"frames.csv")
        var frames=0;var badLines=0;var lastCount=0
        csv.bufferedWriter(Charsets.UTF_8).use { out ->
            out.write("elapsed_ms,timestamp_ms,side,count,tracking,discard,inference_ms,js_logic_ms,packet_age_ms,reasons,codes,left_quality,right_quality,left_elbow_deg,right_elbow_deg,left_hip_signed,right_hip_signed\n")
            File(dir,"telemetry.jsonl").forEachLine(Charsets.UTF_8) { line ->
                try {
                    val record=JSONObject(line)
                    if(record.optString("type")=="frame") {
                        val d=record.getJSONObject("data");frames++;if(!d.isNull("count"))lastCount=d.optInt("count")
                        val dg=d.optJSONObject("diagnostics")
                        val left=dg?.optJSONObject("left");val right=dg?.optJSONObject("right")
                        val values=listOf(d.opt("elapsed_ms"),d.opt("timestamp_ms"),d.opt("side"),d.opt("count"),d.opt("tracking"),d.opt("discard"),
                            d.opt("inference_ms"),d.opt("js_logic_ms"),d.opt("packet_age_ms"),d.opt("reasons"),d.opt("codes"),
                            left?.opt("quality"),right?.opt("quality"),left?.optJSONObject("features")?.opt("elbow"),right?.optJSONObject("features")?.opt("elbow"),
                            left?.optJSONObject("features")?.opt("hip"),right?.optJSONObject("features")?.opt("hip"))
                        out.write(values.joinToString(",") { v -> "\""+(if(v==null||v==JSONObject.NULL) "" else v.toString()).replace("\"","\"\"")+"\"" }+"\n")
                    }
                } catch (_: Exception) { badLines++ }
            }
        }
        val integrity=JSONObject().put("frame_rows",frames).put("unreadable_lines",badLines).put("last_logged_count",lastCount)
            .put("summary_present",File(dir,"summary.json").exists()).put("note","A crash can lose the last buffered second; raw telemetry is retained even for malformed final lines.")
        val report=File(dir,"export_integrity.json");report.writeText(integrity.toString(2),Charsets.UTF_8)
        if(!File(dir,"summary.json").exists())summary(id,JSONObject().put("session_id",id).put("complete",false).put("count",lastCount).put("note","No final summary: interrupted session; inspect telemetry.").toString())
        ZipOutputStream(target.outputStream().buffered()).use { zip ->
            for(name in listOf("metadata.json","summary.json","telemetry.jsonl","frames.csv","export_integrity.json")) {
                zip.putNextEntry(ZipEntry(name));File(dir,name).inputStream().use { it.copyTo(zip) };zip.closeEntry()
            }
            for(file in dir.listFiles().orEmpty().filter{it.isFile&&(it.name=="set_result.json"||it.name=="clip_manifest.json"||it.name.matches(Regex("clip-rep-[0-9]+\\.mp4")))}) {
                zip.putNextEntry(ZipEntry(file.name));file.inputStream().use{it.copyTo(zip)};zip.closeEntry()
            }
            zip.putNextEntry(ZipEntry("README.txt"));zip.write(("Barofit mobile diagnostics v1\n"+
                "metadata.json: device, model/config, landmark IDs, policy thresholds.\n"+
                "summary.json: counts, manual observation (optional), performance and coverage. complete=false means unfinished.\n"+
                "telemetry.jsonl: every received inference packet plus lifecycle, camera, side, count and feedback events.\n"+
                "frames.csv: compact frame metrics; use telemetry for both-side joint confidence/coordinates/reasons.\n"+
                "Coordinates: normalized unmirrored model input, anatomical left/right. Video input sessions may include explicitly generated representative MP4 clips (no audio).\n"+
                "Time: elapsed_ms from first inference packet, monotonic timestamp_ms; wall_time is UTC.\n"+
                "Shared/saved only when explicitly exported. Pair with your screen recording to judge feedback correctness.\n").toByteArray(Charsets.UTF_8));zip.closeEntry()
        }
        return target
    }
}
