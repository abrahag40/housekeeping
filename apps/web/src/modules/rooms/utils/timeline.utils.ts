import {
  startOfDay, differenceInCalendarDays, addDays,
  format, isToday, isBefore, isEqual, isAfter,
} from 'date-fns'
import { es } from 'date-fns/locale'
import type { StayStatus } from '../types/timeline.types'

export function dateToX(
  date: Date,
  calendarStart: Date,
  dayWidth: number,
): number {
  const days = differenceInCalendarDays(startOfDay(date), startOfDay(calendarStart))
  return Math.max(0, days) * dayWidth
}

export function xToDate(
  x: number,
  calendarStart: Date,
  dayWidth: number,
): Date {
  const days = Math.round(x / dayWidth)
  return addDays(startOfDay(calendarStart), days)
}

export function stayToRect(params: {
  checkIn: Date
  checkOut: Date
  rowIndex: number
  calendarStart: Date
  dayWidth: number
  rowHeight: number
}): { x: number; y: number; width: number; height: number } {
  const { checkIn, checkOut, rowIndex, calendarStart, dayWidth, rowHeight } = params

  // Check-in starts at the CENTER of the day (PM half)
  const checkInDays = differenceInCalendarDays(startOfDay(checkIn), startOfDay(calendarStart))
  const x = checkInDays * dayWidth + dayWidth / 2

  // Check-out ends at the CENTER of the checkout day (AM half)
  const checkOutDays = differenceInCalendarDays(startOfDay(checkOut), startOfDay(calendarStart))
  const endX = checkOutDays * dayWidth + dayWidth / 2

  return {
    x,
    y: rowIndex * rowHeight,
    width: Math.max(endX - x, dayWidth / 2),
    height: rowHeight - 2,
  }
}

export function generateDays(start: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i))
}

export function getStayStatus(checkIn: Date, checkOut: Date, actualCheckout?: Date): StayStatus {
  const today = startOfDay(new Date())
  const inDay = startOfDay(checkIn)
  const outDay = startOfDay(checkOut)

  // Physically checked out — confirmed by reception
  if (actualCheckout) return 'DEPARTED'
  // Already left (checkout day is strictly in the past)
  if (isBefore(outDay, today)) return 'DEPARTED'
  // Sale hoy — checkout pendiente
  if (isEqual(outDay, today)) return 'DEPARTING'
  // In-house: check-in past or today, checkout future
  if ((isBefore(inDay, today) || isEqual(inDay, today)) && isAfter(outDay, today))
    return 'IN_HOUSE'
  // Future arrival
  return 'ARRIVING'
}

export function formatDayHeader(date: Date): {
  dayNum: string
  dayName: string
  monthName: string
  isToday: boolean
  isWeekend: boolean
} {
  const day = date.getDay()
  return {
    dayNum: format(date, 'd'),
    dayName: format(date, 'EEE', { locale: es }),
    monthName: format(date, 'MMMM yyyy', { locale: es }),
    isToday: isToday(date),
    isWeekend: day === 0 || day === 6,
  }
}
