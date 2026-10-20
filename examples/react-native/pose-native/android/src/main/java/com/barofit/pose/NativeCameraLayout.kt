package com.barofit.pose

import android.content.Context
import android.view.View
import android.widget.FrameLayout

/**
 * RN lays out the outer view, but CameraX inserts a TextureView later.
 * Measure/layout these Android-owned children explicitly after requestLayout.
 */
open class NativeCameraLayout(context: Context) : FrameLayout(context) {
    private var ready = false
    private var queued = false
    private var measuringChildren = false
    private val relayout = Runnable {
        queued = false
        if (width > 0 && height > 0) layoutNativeChildren()
    }
    init { ready = true }
    override fun requestLayout() {
        super.requestLayout()
        if (ready && !queued && !measuringChildren) {
            queued = true
            post(relayout)
        }
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); requestLayout() }
    override fun onDetachedFromWindow() {
        removeCallbacks(relayout); queued = false
        super.onDetachedFromWindow()
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w,h,oldw,oldh); requestLayout()
    }
    internal fun layoutNativeChildren() {
        if (width <= 0 || height <= 0 || measuringChildren) return
        measuringChildren = true
        try {
            val w = width; val h = height
            val ws = View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY)
            val hs = View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY)
            measure(ws, hs)
            layout(left, top, left+w, top+h)
            for (i in 0 until childCount) {
                getChildAt(i).apply { measure(ws,hs); layout(0,0,w,h) }
            }
            if (viewTreeObserver.isAlive) viewTreeObserver.dispatchOnGlobalLayout()
        } finally { measuringChildren = false }
    }
}
