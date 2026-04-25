import { Injectable } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { NotificationsService } from '../notifications/notifications.service'

/**
 * Bridges EventEmitter2 events from PMS modules (guest-stays, room-readiness)
 * to the SSE stream so the web dashboard updates in real time.
 */
@Injectable()
export class PmsSseListener {
  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent('room.ready')
  onRoomReady(payload: { roomId: string; propertyId: string }) {
    this.notifications.emit(payload.propertyId, 'room:ready', {
      roomId: payload.roomId,
      newStatus: 'AVAILABLE',
    })
  }

  @OnEvent('checkout.confirmed')
  onCheckoutConfirmed(payload: {
    roomId: string
    propertyId: string
    guestName?: string
  }) {
    this.notifications.emit(payload.propertyId, 'checkout:confirmed', {
      roomId: payload.roomId,
      guestName: payload.guestName,
      newStatus: 'CHECKING_OUT',
    })
  }

  @OnEvent('checkin.completed')
  onCheckinCompleted(payload: {
    roomId: string
    propertyId: string
    guestName?: string
  }) {
    this.notifications.emit(payload.propertyId, 'checkin:completed', {
      roomId: payload.roomId,
      guestName: payload.guestName,
      newStatus: 'OCCUPIED',
    })
  }

  @OnEvent('room.moved')
  onRoomMoved(payload: {
    fromRoomId: string
    toRoomId: string
    propertyId: string
  }) {
    this.notifications.emit(payload.propertyId, 'room:moved', {
      fromRoomId: payload.fromRoomId,
      toRoomId: payload.toRoomId,
    })
  }

  @OnEvent('checkout.early')
  onEarlyCheckout(payload: {
    roomId: string
    propertyId: string
    stayId: string
    guestName?: string
    freedFrom: string
    freedTo: string
  }) {
    this.notifications.emit(payload.propertyId, 'checkout:early', {
      roomId: payload.roomId,
      stayId: payload.stayId,
      guestName: payload.guestName,
      freedFrom: payload.freedFrom,
      freedTo: payload.freedTo,
      newStatus: 'CHECKING_OUT',
    })
  }

  @OnEvent('checkin.confirmed')
  onCheckinConfirmed(payload: {
    stayId: string
    roomId: string
    propertyId: string
    guestName?: string
  }) {
    this.notifications.emit(payload.propertyId, 'checkin:confirmed', {
      stayId:    payload.stayId,
      roomId:    payload.roomId,
      guestName: payload.guestName,
    })
  }

  @OnEvent('soft-lock.acquired')
  onSoftLockAcquired(payload: { roomId: string; userName: string; propertyId: string }) {
    this.notifications.emit(payload.propertyId, 'soft:lock:acquired', {
      roomId: payload.roomId,
      lockedByName: payload.userName,
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    })
  }

  @OnEvent('soft-lock.released')
  onSoftLockReleased(payload: { roomId: string; propertyId: string }) {
    this.notifications.emit(payload.propertyId, 'soft:lock:released', {
      roomId: payload.roomId,
    })
  }
}
