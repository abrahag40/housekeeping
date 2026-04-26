import { useState, useRef, useEffect, useCallback } from 'react'

interface TooltipPosition {
  x: number
  y: number
  placement: 'top' | 'bottom'
}

export function useTooltip(options?: { forceAbove?: boolean }) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<TooltipPosition>({
    x: 0, y: 0, placement: 'top',
  })
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipElRef = useRef<HTMLDivElement | null>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const isInsideTriggerRef = useRef(false)
  const isInsideTooltipRef = useRef(false)
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const visibleRef = useRef(false)

  const { forceAbove = false } = options ?? {}

  const calculatePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const { x: mouseX } = mousePosRef.current

    // Flip to 'bottom' when there is not enough space above the block.
    // 280px covers the tallest tooltip variant (with no-show action panel).
    // forceAbove bypasses the flip for non-last journey segments where the
    // next segment block sits immediately below and would be obscured.
    const TOOLTIP_MIN_TOP = 280
    const placement: 'top' | 'bottom' =
      forceAbove || rect.top >= TOOLTIP_MIN_TOP ? 'top' : 'bottom'

    // Clamp horizontally so the tooltip (320px wide) stays in view.
    const TOOLTIP_HALF = 162
    const clampedX = Math.max(TOOLTIP_HALF, Math.min(mouseX, window.innerWidth - TOOLTIP_HALF))

    // top → tooltip bottom aligns with block top − 8px gap (translateY(-100%) in portal)
    // bottom → tooltip top aligns with block bottom + 8px gap (translateY(0) in portal)
    const y = placement === 'top' ? rect.top - 8 : rect.bottom + 8

    setPosition({
      x: clampedX,
      y,
      placement,
    })
  }, [forceAbove])

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (!isInsideTriggerRef.current && !isInsideTooltipRef.current) {
        visibleRef.current = false
        setVisible(false)
      }
    }, 120)
  }, [])

  // Callback ref for the tooltip portal element
  const registerTooltipRef = useCallback((el: HTMLDivElement | null) => {
    // Cleanup previous listeners
    const prev = tooltipElRef.current
    if (prev) {
      prev.removeEventListener('mouseenter', handleTooltipEnter)
      prev.removeEventListener('mouseleave', handleTooltipLeave)
    }

    tooltipElRef.current = el

    if (el) {
      el.addEventListener('mouseenter', handleTooltipEnter)
      el.addEventListener('mouseleave', handleTooltipLeave)
    }

    function handleTooltipEnter() {
      isInsideTooltipRef.current = true
      clearTimeout(hideTimerRef.current)
    }

    function handleTooltipLeave() {
      isInsideTooltipRef.current = false
      scheduleHide()
    }
  }, [scheduleHide])

  useEffect(() => {
    const el = triggerRef.current
    if (!el) return

    function handleMouseMove(e: MouseEvent) {
      // Track cursor X so calculatePosition uses where the user is hovering,
      // but only update while tooltip is not yet visible (before the delay fires).
      if (!visibleRef.current) {
        mousePosRef.current = { x: e.clientX, y: e.clientY }
      }
    }

    function handleEnter(e: MouseEvent) {
      mousePosRef.current = { x: e.clientX, y: e.clientY }
      isInsideTriggerRef.current = true
      clearTimeout(hideTimerRef.current)

      showTimerRef.current = setTimeout(() => {
        if (!isInsideTriggerRef.current) return
        calculatePosition()
        visibleRef.current = true
        setVisible(true)
      }, 350)
    }

    function handleLeave() {
      isInsideTriggerRef.current = false
      clearTimeout(showTimerRef.current)
      scheduleHide()
    }

    el.addEventListener('mouseenter', handleEnter)
    el.addEventListener('mousemove', handleMouseMove)
    el.addEventListener('mouseleave', handleLeave)

    return () => {
      el.removeEventListener('mouseenter', handleEnter)
      el.removeEventListener('mousemove', handleMouseMove)
      el.removeEventListener('mouseleave', handleLeave)
      clearTimeout(showTimerRef.current)
      clearTimeout(hideTimerRef.current)
    }
  }, [calculatePosition, scheduleHide])

  // Safety net: window blur hides tooltip
  useEffect(() => {
    function handleBlur() {
      isInsideTriggerRef.current = false
      isInsideTooltipRef.current = false
      clearTimeout(showTimerRef.current)
      clearTimeout(hideTimerRef.current)
      setVisible(false)
    }

    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [])

  // Recalculate position on scroll while visible
  useEffect(() => {
    function handleScroll() {
      if (visibleRef.current) calculatePosition()
    }

    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [calculatePosition])

  const hide = useCallback(() => {
    isInsideTriggerRef.current = false
    isInsideTooltipRef.current = false
    clearTimeout(showTimerRef.current)
    clearTimeout(hideTimerRef.current)
    visibleRef.current = false
    setVisible(false)
  }, [])

  return { triggerRef, registerTooltipRef, visible, position, hide }
}
