package com.barofit.pose

import android.app.Activity
import android.view.View
import android.widget.FrameLayout
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import android.os.Looper

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativeCameraLayoutTest {
    @Test fun latePreviewChildIsMeasuredAfterReactSizesOuterView() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val camera = NativeCameraLayout(activity)
        val preview = FrameLayout(activity)
        camera.addView(preview, FrameLayout.LayoutParams(-1,-1))
        // Like ReactRootView, this host does not traverse children in Android onLayout.
        val reactHost = object : FrameLayout(activity) {
            override fun onMeasure(w: Int, h: Int) {
                setMeasuredDimension(View.MeasureSpec.getSize(w),View.MeasureSpec.getSize(h))
            }
            override fun onLayout(changed: Boolean,l: Int,t: Int,r: Int,b: Int) {}
        }
        reactHost.addView(camera)
        activity.setContentView(reactHost)
        shadowOf(Looper.getMainLooper()).idle()
        // React Native explicitly lays out the outer view before CameraX creates a surface child.
        camera.measure(View.MeasureSpec.makeMeasureSpec(640,View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(360,View.MeasureSpec.EXACTLY))
        camera.layout(0,0,640,360)
        shadowOf(Looper.getMainLooper()).idle()
        val surfaceChild = View(activity)
        preview.addView(surfaceChild, FrameLayout.LayoutParams(-1,-1))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(640, surfaceChild.measuredWidth)
        assertEquals(360, surfaceChild.measuredHeight)
        assertEquals(640, surfaceChild.width)
        assertEquals(360, surfaceChild.height)
        controller.pause().stop().destroy()
    }
}
