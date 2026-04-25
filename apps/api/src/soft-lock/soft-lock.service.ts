import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { EventEmitter2 } from '@nestjs/event-emitter'

interface LockEntry {
  userId: string
  userName: string
  propertyId: string
  expiresAt: Date
}

const TTL_MS = 90_000

@Injectable()
export class SoftLockService {
  private readonly locks = new Map<string, LockEntry>()

  constructor(private readonly events: EventEmitter2) {}

  acquire(roomId: string, userId: string, userName: string, propertyId: string): boolean {
    const existing = this.locks.get(roomId)
    if (existing && existing.expiresAt > new Date() && existing.userId !== userId) {
      return false
    }
    this.locks.set(roomId, {
      userId,
      userName,
      propertyId,
      expiresAt: new Date(Date.now() + TTL_MS),
    })
    this.events.emit('soft-lock.acquired', { roomId, userName, propertyId })
    return true
  }

  release(roomId: string, userId: string): void {
    const existing = this.locks.get(roomId)
    if (!existing || existing.userId !== userId) return
    const propertyId = existing.propertyId
    this.locks.delete(roomId)
    this.events.emit('soft-lock.released', { roomId, propertyId })
  }

  heartbeat(roomId: string, userId: string): void {
    const existing = this.locks.get(roomId)
    if (!existing || existing.userId !== userId) return
    existing.expiresAt = new Date(Date.now() + TTL_MS)
  }

  getStatus(roomId: string, requestingUserId?: string): { locked: boolean; byCurrentUser: boolean; lockedByName?: string } {
    const existing = this.locks.get(roomId)
    if (!existing || existing.expiresAt <= new Date()) {
      return { locked: false, byCurrentUser: false }
    }
    return {
      locked: true,
      byCurrentUser: existing.userId === requestingUserId,
      lockedByName: existing.userName,
    }
  }

  // Sweep expired locks every minute and emit released events for each
  @Cron('* * * * *')
  sweepExpired(): void {
    const now = new Date()
    for (const [roomId, entry] of this.locks.entries()) {
      if (entry.expiresAt <= now) {
        this.locks.delete(roomId)
        this.events.emit('soft-lock.released', { roomId, propertyId: entry.propertyId })
      }
    }
  }
}
