package com.barofit.pose

import org.junit.Test
import org.junit.Rule
import org.junit.Assert.*
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.zip.ZipFile
import org.json.JSONObject

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class DiagnosticStoreTest {
    @get:Rule val temp=TemporaryFolder()
    @Test fun persistsAndExportsRecoverableSessionWithFrameCsv(){
        val root=temp.newFolder("sessions");val store=DiagnosticStore(root)
        store.begin("test-001","{\"created_at\":\"2026-10-15\"}")
        store.append("test-001","{\"seq\":1,\"type\":\"frame\",\"data\":{\"elapsed_ms\":0,\"count\":2,\"side\":\"left\",\"reasons\":[\"ankle:low_visibility\"]}}\n")
        store.append("test-001","{truncated")
        val reloaded=DiagnosticStore(root);assertEquals(1,reloaded.list().size)
        val zip=reloaded.export("test-001",temp.newFolder("exports"))
        ZipFile(zip).use { z ->
            assertNotNull(z.getEntry("metadata.json"));assertNotNull(z.getEntry("telemetry.jsonl"))
            assertTrue(z.getInputStream(z.getEntry("frames.csv")).bufferedReader().readText().contains("left"))
            val integrity=JSONObject(z.getInputStream(z.getEntry("export_integrity.json")).bufferedReader().readText())
            assertEquals(1,integrity.getInt("unreadable_lines"));assertEquals(2,integrity.getInt("last_logged_count"))
            val summary=JSONObject(z.getInputStream(z.getEntry("summary.json")).bufferedReader().readText())
            assertFalse(summary.getBoolean("complete"))
        }
        reloaded.summary("test-001","{\"count\":3,\"complete\":true}")
        assertEquals(3,JSONObject(File(root,"test-001/summary.json").readText()).getInt("count"))
    }
    @Test fun rejectsTraversalAndDuplicateSessions(){
        val store=DiagnosticStore(temp.newFolder("sessions"))
        assertThrows(IllegalArgumentException::class.java){store.directory("../escape")}
        store.begin("test-002","{}")
        assertThrows(IllegalStateException::class.java){store.begin("test-002","{}")}
    }
}
