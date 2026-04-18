import { useState, useCallback } from 'react'
import { startOfDay } from 'date-fns'
import { TIMELINE } from '../utils/timeline.constants'
import type {
  DragState, DropResult, GuestStayBlock, FlatRow,
} from '../types/timeline.types'

interface UseDragDropParams {
  flatRows: FlatRow[]
  stays: GuestStayBlock[]
  onDropSuccess: (result: DropResult) => void
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
}: UseDragDropParams) {
  const [dragState, setDragState] = useState<DragState | null>(null)

  const handleDragStart = useCallback((stayId: string, _clientX: number) => {
    const stay = stays.find(s => s.id === stayId)
    if (!stay) return

    setDragState({
      stayId,
      originalRoomId: stay.roomId,
      originalCheckIn: stay.checkIn,
      originalCheckOut: stay.checkOut,
      nights: stay.nights,
      currentRoomId: stay.roomId,
      currentCheckIn: stay.checkIn,
      currentCheckOut: stay.checkOut,
      isValid: true,
    })
  }, [stays])

  const handleDragMove = useCallback((
    _clientX: number,
    gridY: number,
  ) => {
    if (!dragState) return

    // Vertical-only: dates stay exactly the same
    const newCheckIn = dragState.originalCheckIn
    const newCheckOut = dragState.originalCheckOut

    const targetRoom = findRoomAtGridY(flatRows, gridY)
    if (!targetRoom) return

    const { conflict, reason } = hasConflict({
      stayId: dragState.stayId,
      targetRoomId: targetRoom.id,
      checkIn: newCheckIn,
      checkOut: newCheckOut,
      stays,
    })

    setDragState(prev => prev ? {
      ...prev,
      currentRoomId: targetRoom.id,
      currentCheckIn: newCheckIn,
      currentCheckOut: newCheckOut,
      isValid: !conflict,
      conflictReason: reason,
    } : null)
  }, [dragState, flatRows, stays])

  const handleDragEnd = useCallback(() => {
    if (!dragState) return

    const moved = dragState.currentRoomId !== dragState.originalRoomId

    if (moved && dragState.isValid) {
      onDropSuccess({
        stayId: dragState.stayId,
        newRoomId: dragState.currentRoomId,
        newCheckIn: dragState.currentCheckIn,
        newCheckOut: dragState.currentCheckOut,
      })
    }

    setDragState(null)
  }, [dragState, onDropSuccess])

  const handleDragCancel = useCallback(() => {
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
