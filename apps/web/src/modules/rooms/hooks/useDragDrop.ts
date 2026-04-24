import { useState, useCallback, useRef } from 'react'
import { startOfDay } from 'date-fns'
import { TIMELINE } from '../utils/timeline.constants'
import type {
  DragState, DropResult, GuestStayBlock, FlatRow,
} from '../types/timeline.types'

interface UseDragDropParams {
  flatRows: FlatRow[]
  stays: GuestStayBlock[]
  onDropSuccess: (result: DropResult) => void
  /** Called when the user drops on an invalid target (conflict). Used to surface
   *  a visible error toast so the receptionist understands *why* the drop was
   *  rejected — silent failure violates Nielsen #1 (system status visibility). */
  onDropInvalid?: (reason: string) => void
  /** Called when the user starts dragging a block that has no movable handle
   *  (locked segment, past stay, etc.). Used to explain the block in context. */
}

function findRoomAtGridY(flatRows: FlatRow[], gridY: number) {
  let accY = 0
  for (let i = 0; i < flatRows.length; i++) {
    const row = flatRows[i]
    const h = row.type === 'group'
      ? TIMELINE.GROUP_HEADER_HEIGHT
      : TIMELINE.ROW_HEIGHT

    if (gridY >= accY && gridY < accY + h) {
      if (row.type === 'room') return row.room!

      // Cursor is on a group header — snap to first room below it
      for (let j = i + 1; j < flatRows.length; j++) {
        if (flatRows[j].type === 'room') return flatRows[j].room!
      }
    }
    accY += h
  }
  // Clamp: if past the last row, return the last room
  for (let i = flatRows.length - 1; i >= 0; i--) {
    if (flatRows[i].type === 'room') return flatRows[i].room!
  }
  return null
}

function hasConflict(params: {
  stayId: string
  targetRoomId: string
  checkIn: Date
  checkOut: Date
  stays: GuestStayBlock[]
}): { conflict: boolean; reason?: string } {
  const { stayId, targetRoomId, checkIn, checkOut, stays } = params

  const conflicting = stays.find(s => {
    if (s.id === stayId) return false
    if (s.roomId !== targetRoomId) return false
    if (s.actualCheckout) return false // already checked out — not a real occupancy conflict
    if (s.noShowAt) return false       // no-show releases inventory (CLAUDE.md §17)

    const sIn = startOfDay(new Date(s.checkIn))
    const sOut = startOfDay(new Date(s.checkOut))
    const nIn = startOfDay(checkIn)
    const nOut = startOfDay(checkOut)

    return sOut > nIn && sIn < nOut
  })

  if (conflicting) {
    return { conflict: true, reason: `Conflicto con ${conflicting.guestName}` }
  }
  return { conflict: false }
}

export function useDragDrop({
  flatRows,
  stays,
  onDropSuccess,
  onDropInvalid,
}: UseDragDropParams) {
  const [dragState, setDragState] = useState<DragState | null>(null)

  // Refs allow stable callbacks that don't depend on closure-captured state.
  // dragStateRef mirrors the state value for use inside handleDragMove/End.
  // flatRowsRef/staysRef mirror their props so we never need them as deps.
  const dragStateRef = useRef<DragState | null>(null)
  const flatRowsRef = useRef(flatRows)
  const staysRef = useRef(stays)
  flatRowsRef.current = flatRows
  staysRef.current = stays

  const handleDragStart = useCallback((stayId: string, _clientX: number) => {
    const stay = staysRef.current.find(s => s.id === stayId)
    if (!stay) return

    const state: DragState = {
      stayId,
      originalRoomId: stay.roomId,
      originalCheckIn: stay.checkIn,
      originalCheckOut: stay.checkOut,
      nights: stay.nights,
      currentRoomId: stay.roomId,
      currentCheckIn: stay.checkIn,
      currentCheckOut: stay.checkOut,
      isValid: true,
    }
    dragStateRef.current = state
    setDragState(state)
  }, []) // stable — reads staysRef.current at call time

  const handleDragMove = useCallback((
    _clientX: number,
    gridY: number,
  ) => {
    const current = dragStateRef.current
    if (!current) return

    const targetRoom = findRoomAtGridY(flatRowsRef.current, gridY)
    if (!targetRoom) return

    const { conflict, reason } = hasConflict({
      stayId: current.stayId,
      targetRoomId: targetRoom.id,
      checkIn: current.originalCheckIn,
      checkOut: current.originalCheckOut,
      stays: staysRef.current,
    })

    // Only trigger a React re-render (row highlight, ghost validity) when the
    // visual state actually changes. Most mousemove events stay within the same
    // row → no state update → no re-render → smooth 60fps ghost via DOM ref.
    const roomChanged = targetRoom.id !== current.currentRoomId
    const validityChanged = !conflict !== current.isValid
    if (!roomChanged && !validityChanged) return

    const next: DragState = {
      ...current,
      currentRoomId: targetRoom.id,
      currentCheckIn: current.originalCheckIn,
      currentCheckOut: current.originalCheckOut,
      isValid: !conflict,
      conflictReason: reason,
    }
    dragStateRef.current = next
    setDragState(next)
  }, []) // stable — reads all data from refs

  const handleDragEnd = useCallback(() => {
    const current = dragStateRef.current
    if (!current) return

    const moved = current.currentRoomId !== current.originalRoomId

    if (moved && current.isValid) {
      onDropSuccess({
        stayId: current.stayId,
        newRoomId: current.currentRoomId,
        newCheckIn: current.currentCheckIn,
        newCheckOut: current.currentCheckOut,
      })
    } else if (moved && !current.isValid && onDropInvalid) {
      // Surface the rejection reason. Silent failure on drag-drop is the top
      // usability defect in scheduler UIs (NNG 2020 — Drag-and-Drop: How to
      // Design Drop Zones); the user must know *why* their gesture didn't work.
      onDropInvalid(current.conflictReason ?? 'La habitación destino no está disponible')
    }

    dragStateRef.current = null
    setDragState(null)
  }, [onDropSuccess])

  const handleDragCancel = useCallback(() => {
    dragStateRef.current = null
    setDragState(null)
  }, [])

  return {
    dragState,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  }
}
