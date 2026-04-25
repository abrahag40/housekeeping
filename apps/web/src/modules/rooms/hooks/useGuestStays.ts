import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { startOfDay } from 'date-fns'
import toast from 'react-hot-toast'
import { api, ApiError } from '@/api/client'
import { guestStaysApi } from '../api/guest-stays.api'
import type { NewStayData } from '../components/dialogs/CheckInDialog'
import { OTA_OPTIONS } from '../components/dialogs/CheckInDialog'
import type { GuestStayBlock } from '../types/timeline.types'

/** Converts a raw API record (Prisma GuestStay) into the frontend GuestStayBlock. */
function adaptStay(raw: Record<string, unknown>): GuestStayBlock {
  const checkIn  = new Date(raw.checkinAt as string)
  const checkOut = new Date(raw.scheduledCheckout as string)
  const nights   = Math.max(1, Math.round(
    (checkOut.getTime() - checkIn.getTime()) / 86400000
  ))
  const source = (raw.source as string) ?? 'other'
  const ota = OTA_OPTIONS.find(o => o.value === source)

  const stayJourney = raw.stayJourney as { id: string } | null | undefined
  return {
    id:               raw.id as string,
    roomId:           raw.roomId as string,
    guestName:        raw.guestName as string,
    journeyId:        stayJourney?.id ?? undefined,
    guestEmail:       raw.guestEmail as string | undefined,
    guestPhone:       raw.guestPhone as string | undefined,
    nationality:      raw.nationality as string | undefined,
    documentType:     raw.documentType as string | undefined,
    paxCount:         (raw.paxCount as number) ?? 1,
    checkIn,
    checkOut,
    nights,
    ratePerNight:     Number(raw.ratePerNight),
    totalAmount:      Number(raw.totalAmount),
    amountPaid:       Number(raw.amountPaid),
    paymentStatus:    raw.paymentStatus as GuestStayBlock['paymentStatus'],
    currency:         (raw.currency as string) ?? 'USD',
    source,
    otaName:          ota?.label ?? source,
    pmsReservationId: raw.pmsReservationId as string | undefined,
    notes:            raw.notes as string | undefined,
    isLocked:         false,
    actualCheckin:    raw.actualCheckin ? new Date(raw.actualCheckin as string) : undefined,
    actualCheckout:   raw.actualCheckout ? new Date(raw.actualCheckout as string) : undefined,
    noShowAt:             raw.noShowAt ? new Date(raw.noShowAt as string) : undefined,
    noShowFeeAmount:      raw.noShowFeeAmount != null ? Number(raw.noShowFeeAmount) : undefined,
    noShowFeeCurrency:    raw.noShowFeeCurrency as string | undefined,
    noShowChargeStatus:   raw.noShowChargeStatus as GuestStayBlock['noShowChargeStatus'],
    stripePaymentMethodId: raw.stripePaymentMethodId as string | undefined,
  }
}

export function useGuestStays(propertyId: string, from: Date, to: Date) {
  return useQuery({
    queryKey: [
      'guest-stays',
      propertyId,
      startOfDay(from).toISOString(),
      startOfDay(to).toISOString(),
    ],
    queryFn:  async () => {
      const raw = await guestStaysApi.list(propertyId, from, to)
      return raw.map(adaptStay)
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    enabled: !!propertyId,
    placeholderData: keepPreviousData,
  })
}

export function useCreateGuestStay(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (data: NewStayData & { propertyId: string }) => {
      const { documentPhoto: _photo, ...rest } = data
      return guestStaysApi.create({
        ...rest,
        propertyId: data.propertyId,
        adults: data.adults ?? 1,
        children: data.children ?? 0,
        amountPaid: data.amountPaid ?? 0,
        guestEmail: data.guestEmail || undefined,
        guestPhone: data.guestPhone || undefined,
        checkIn:  new Date(data.checkIn).toISOString(),
        checkOut: new Date(data.checkOut).toISOString(),
      })
    },

    onMutate: async (data) => {
      // Cancelar fetches en vuelo
      await qc.cancelQueries({
        predicate: (q) =>
          q.queryKey[0] === 'guest-stays' && q.queryKey[1] === propertyId,
      })

      // Snapshot vía findAll (TanStack v5 API)
      const stayQueries = qc.getQueryCache().findAll({
        predicate: (q) =>
          q.queryKey[0] === 'guest-stays' && q.queryKey[1] === propertyId,
      })
      const snapshots = stayQueries.map((q) => ({
        key: q.queryKey,
        data: q.state.data as GuestStayBlock[] | undefined,
      }))

      const checkInDate = new Date(data.checkIn)
      const checkOutDate = new Date(data.checkOut)
      const nights = Math.max(
        1,
        Math.round((checkOutDate.getTime() - checkInDate.getTime()) / 86400000),
      )
      const ota = OTA_OPTIONS.find((o) => o.value === data.source)

      const optimisticStay: GuestStayBlock = {
        id: 'temp-' + Date.now(),
        roomId: data.roomId,
        guestName: `${data.firstName} ${data.lastName}`.trim(),
        checkIn: checkInDate,
        checkOut: checkOutDate,
        nights,
        ratePerNight: data.ratePerNight,
        totalAmount: data.ratePerNight * nights,
        amountPaid: data.amountPaid ?? 0,
        paymentStatus: 'PENDING',
        currency: data.currency,
        source: data.source,
        otaName: ota?.label ?? data.source,
        paxCount: (data.adults ?? 1) + (data.children ?? 0),
        isLocked: false,
        pmsReservationId: 'temp-' + Date.now(),
      }

      // Insertar en cada cache activo de guest-stays
      stayQueries.forEach((q) => {
        const current = q.state.data as GuestStayBlock[] | undefined
        if (current) {
          qc.setQueryData(q.queryKey, [...current, optimisticStay])
        }
      })

      return { snapshots }
    },

    onError: (error, _data, ctx) => {
      ctx?.snapshots?.forEach(({ key, data }) => {
        qc.setQueryData(key, data)
      })
      const msg = error instanceof ApiError
        ? error.message
        : 'Error al crear la reserva'
      toast.error(msg)
      console.error('[CheckIn] mutation error:', error)
    },

    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === 'guest-stays' && q.queryKey[1] === propertyId,
      })
      qc.invalidateQueries({
        queryKey: ['stay-journeys-timeline', propertyId],
        exact: false,
        refetchType: 'active',
      })
      qc.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === 'rooms' && q.queryKey[1] === propertyId,
      })
    },
  })
}

export function useCheckout(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (stayId: string) => guestStaysApi.checkout(stayId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['guest-stays', propertyId],
        exact: false,
        refetchType: 'active',
      })
      qc.invalidateQueries({ queryKey: ['rooms', propertyId], exact: false })
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo realizar el checkout')
    },
  })
}

export function useEarlyCheckout(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ stayId, notes }: { stayId: string; notes?: string }) =>
      guestStaysApi.earlyCheckout(stayId, notes),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['guest-stays', propertyId], exact: false, refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['rooms', propertyId], exact: false })
      const msg =
        result.tasksScheduledFor === 'tomorrow'
          ? 'Salida anticipada registrada — limpieza programada para mañana'
          : 'Salida anticipada registrada — limpieza disponible para hoy'
      toast.success(msg)
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo registrar la salida anticipada')
    },
  })
}

export function useMoveRoom(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ stayId, newRoomId }: { stayId: string; newRoomId: string }) =>
      guestStaysApi.moveRoom(stayId, newRoomId, 'complimentary'),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['guest-stays', propertyId],
        exact: false,
        refetchType: 'active',
      })
      qc.invalidateQueries({ queryKey: ['rooms', propertyId], exact: false })
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo mover la reserva')
    },
  })
}

export function useMarkNoShow(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      stayId,
      reason,
      waiveCharge,
    }: {
      stayId: string
      reason?: string
      waiveCharge?: boolean
    }) => api.post(`/v1/guest-stays/${stayId}/no-show`, { reason, waiveCharge }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guest-stays', propertyId], exact: false, refetchType: 'active' })
      toast.success('No-show registrado')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo marcar no-show')
    },
  })
}

export function useRevertNoShow(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (stayId: string) =>
      api.post(`/v1/guest-stays/${stayId}/revert-no-show`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guest-stays', propertyId], exact: false, refetchType: 'active' })
      toast.success('No-show revertido')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo revertir el no-show')
    },
  })
}

export function useExtendStay(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ stayId, newCheckOut }: { stayId: string; newCheckOut: Date }) =>
      guestStaysApi.extendStay(stayId, newCheckOut),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guest-stays', propertyId], exact: false, refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['stay-journeys-timeline', propertyId], exact: false, refetchType: 'active' })
      toast.success('Estadía extendida')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo extender la estadía')
    },
  })
}

/** Extension via StayJourney endpoint — creates EXTENSION_SAME_ROOM segment (+ext block).
 *  Use this when the stay has a journeyId. Invalidates both guest-stays and
 *  stay-journeys-timeline so the +ext block appears immediately after confirm. */
export function useExtendSameRoom(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ journeyId, newCheckOut }: { journeyId: string; newCheckOut: Date }) =>
      guestStaysApi.extendSameRoom(journeyId, newCheckOut),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guest-stays', propertyId], exact: false, refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['stay-journeys-timeline', propertyId], exact: false, refetchType: 'active' })
      toast.success('Estadía extendida')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo extender la estadía')
    },
  })
}

/** Extension into a different room when the original is unavailable for the new dates.
 *  Creates EXTENSION_NEW_ROOM segment + room-change cleaning tasks. */
export function useExtendNewRoom(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ journeyId, newRoomId, newCheckOut }: { journeyId: string; newRoomId: string; newCheckOut: Date }) =>
      guestStaysApi.extendNewRoom(journeyId, newRoomId, newCheckOut),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guest-stays', propertyId], exact: false, refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['stay-journeys-timeline', propertyId], exact: false, refetchType: 'active' })
      toast.success('Estadía extendida en otra habitación')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo extender en otra habitación')
    },
  })
}

/** Mid-stay room move for IN_HOUSE guests. Routes to stay-journeys endpoint which
 *  creates a ROOM_MOVE segment preserving the StayJourney audit trail. */
export function useSplitMidStay(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      journeyId,
      newRoomId,
      effectiveDate,
      actorId,
    }: {
      journeyId: string
      newRoomId: string
      effectiveDate: Date
      actorId: string
    }) =>
      api.post(`/v1/stay-journeys/${journeyId}/room-move`, {
        newRoomId,
        effectiveDate: effectiveDate.toISOString(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guest-stays', propertyId], exact: false, refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['rooms', propertyId], exact: false })
      toast.success('Habitación cambiada')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo cambiar la habitación')
    },
  })
}

/** Reassign an existing EXTENSION_SAME_ROOM / EXTENSION_NEW_ROOM segment to a different room.
 *  No effectiveDate needed — the extension dates are already fixed.
 *  Invalidates stay-journeys-timeline so the dragged block re-renders in its new row. */
export function useMoveExtensionRoom(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ segmentId, newRoomId }: { segmentId: string; newRoomId: string }) =>
      guestStaysApi.moveExtensionRoom(segmentId, newRoomId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stay-journeys-timeline', propertyId], exact: false, refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['guest-stays', propertyId], exact: false, refetchType: 'active' })
      toast.success('Extensión movida a la nueva habitación')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo mover la extensión')
    },
  })
}

/** Split N-way: reemplaza los segmentos ACTIVE del journey con N tramos nuevos.
 *  Soporta ARRIVING (toda la reserva en N cuartos) e IN_HOUSE (primer tramo
 *  = cuarto actual hasta hoy, resto en otros cuartos). Invalida ambos caches
 *  para que los bloques aparezcan inmediatamente. */
export function useSplitReservation(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      journeyId,
      parts,
    }: {
      journeyId: string
      parts: Array<{ roomId: string; checkIn: Date; checkOut: Date }>
    }) => guestStaysApi.splitReservation(journeyId, parts),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['guest-stays', propertyId], exact: false, refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['stay-journeys-timeline', propertyId], exact: false, refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['rooms', propertyId], exact: false })
      toast.success(`Reserva dividida en ${vars.parts.length} habitaciones`)
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo dividir la reserva')
    },
  })
}

export function useConfirmCheckin(propertyId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({
      stayId,
      data,
    }: {
      stayId: string
      data: Parameters<typeof guestStaysApi.confirmCheckin>[1]
    }) => guestStaysApi.confirmCheckin(stayId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guest-stays', propertyId], exact: false, refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['stay-journeys-timeline', propertyId], exact: false, refetchType: 'active' })
      toast.success('Check-in confirmado — el huésped está en casa')
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'No se pudo confirmar el check-in')
    },
  })
}

export function useLogContact(stayId: string) {
  return useMutation({
    mutationFn: ({
      channel,
      messagePreview,
    }: {
      channel: 'WHATSAPP' | 'EMAIL' | 'PHONE'
      messagePreview?: string
    }) =>
      api.post(`/v1/guest-stays/${stayId}/contact-log`, { channel, messagePreview }),
  })
}

export function useChargeNoShow(stayId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post(`/v1/payments/guest-stays/${stayId}/charge-noshow`, {}),
    onSuccess: () => {
      toast.success('Cargo procesado')
      qc.invalidateQueries({ queryKey: ['guest-stays'], refetchType: 'active' })
    },
    onError: (err: ApiError) => {
      toast.error(err.message ?? 'No se pudo procesar el cargo')
    },
  })
}

export function useWaiveNoShow(stayId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) =>
      api.post(`/v1/payments/guest-stays/${stayId}/waive-noshow`, { reason }),
    onSuccess: () => {
      toast.success('Cargo perdonado')
      qc.invalidateQueries({ queryKey: ['guest-stays'], refetchType: 'active' })
    },
    onError: (err: ApiError) => {
      toast.error(err.message ?? 'No se pudo perdonar el cargo')
    },
  })
}

export function useRoomReadinessTasks(propertyId: string) {
  return useQuery({
    queryKey: ['room-readiness', propertyId],
    queryFn: () =>
      api.get<Record<string, unknown>[]>(
        `/v1/room-readiness?propertyId=${propertyId}`,
      ),
    staleTime: 15_000,
    enabled: !!propertyId,
  })
}
