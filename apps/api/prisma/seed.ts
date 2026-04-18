import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Create organization
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: {
      id: 'seed-org-1',
      name: 'Demo Organization',
      slug: 'demo-org',
      plan: 'STARTER',
    },
  })
  console.log(`✅ Organization: ${org.name}`)

  // Create a property
  const property = await prisma.property.upsert({
    where: { id: 'seed-property-1' },
    update: {},
    create: {
      id: 'seed-property-1',
      name: 'Hotel Demo',
    },
  })
  console.log(`✅ Property: ${property.name}`)

  // Create shared dorm rooms (hostal-style)
  const dorm1 = await prisma.room.upsert({
    where: { propertyId_number: { propertyId: property.id, number: 'Dorm1' } },
    update: {},
    create: {
      propertyId: property.id,
      number: 'Dorm1',
      floor: 1,
      category: 'SHARED',
      capacity: 6,
    },
  })

  const dorm2 = await prisma.room.upsert({
    where: { propertyId_number: { propertyId: property.id, number: 'Dorm2' } },
    update: {},
    create: {
      propertyId: property.id,
      number: 'Dorm2',
      floor: 1,
      category: 'SHARED',
      capacity: 4,
    },
  })

  // Create private rooms (hotel-style)
  const room101 = await prisma.room.upsert({
    where: { propertyId_number: { propertyId: property.id, number: '101' } },
    update: {},
    create: {
      propertyId: property.id,
      number: '101',
      floor: 1,
      category: 'PRIVATE',
      capacity: 2,
    },
  })

  const room102 = await prisma.room.upsert({
    where: { propertyId_number: { propertyId: property.id, number: '102' } },
    update: {},
    create: {
      propertyId: property.id,
      number: '102',
      floor: 1,
      category: 'PRIVATE',
      capacity: 2,
    },
  })
  console.log('✅ Rooms created')

  /**
   * Re-crea las camas de una habitación desde cero.
   *
   * Por qué deleteMany + create en lugar de upsert:
   *   Las versiones antiguas del seed usaban IDs no-UUID ('dorm1-Cama1') y labels sin
   *   espacio ('Cama1'). Si hiciéramos upsert por label, los beds antiguos ('Cama1')
   *   no coincidirían con los nuevos ('Cama 1') y quedarían huérfanos en la BD,
   *   acumulando basura. Al borrar y recrear, garantizamos una pizarra limpia con
   *   UUIDs válidos y labels consistentes en cada ejecución del seed.
   *
   * PRECAUCIÓN: En producción, este borrado cascadea tareas y discrepancias.
   * Este seed es solo para desarrollo/demo — nunca ejecutarlo en producción.
   */
  async function recreateBeds(roomId: string, beds: { label: string; status: string }[]) {
    // Obtener IDs de camas actuales para borrar sus dependencias en orden
    const existingBeds = await prisma.bed.findMany({ where: { roomId }, select: { id: true } })
    const bedIds = existingBeds.map((b) => b.id)

    if (bedIds.length > 0) {
      // Borrar en orden: primero los registros hijo, luego las tareas, luego las camas
      // (FK: TaskLog → CleaningTask → Bed, CleaningNote → CleaningTask, etc.)
      await prisma.taskLog.deleteMany({ where: { task: { bedId: { in: bedIds } } } })
      await prisma.cleaningNote.deleteMany({ where: { task: { bedId: { in: bedIds } } } })
      await prisma.maintenanceIssue.deleteMany({ where: { task: { bedId: { in: bedIds } } } })
      await prisma.cleaningTask.deleteMany({ where: { bedId: { in: bedIds } } })
      await prisma.bedDiscrepancy.deleteMany({ where: { bedId: { in: bedIds } } })
    }

    await prisma.bed.deleteMany({ where: { roomId } })
    // Crear las camas nuevas con UUIDs válidos
    for (const { label, status } of beds) {
      await prisma.bed.create({ data: { id: randomUUID(), label, roomId, status: status as never } })
    }
  }

  // Create beds for dorms — status refleja la ocupación del demo
  await recreateBeds(dorm1.id, [
    { label: 'Cama 1', status: 'AVAILABLE' },
    { label: 'Cama 2', status: 'AVAILABLE' },
    { label: 'Cama 3', status: 'AVAILABLE' },
    { label: 'Cama 4', status: 'AVAILABLE' },
    { label: 'Cama 5', status: 'AVAILABLE' },
    { label: 'Cama 6', status: 'AVAILABLE' },
  ])
  await recreateBeds(dorm2.id, [
    { label: 'Cama 1', status: 'OCCUPIED' },
    { label: 'Cama 2', status: 'OCCUPIED' },
    { label: 'Cama 3', status: 'OCCUPIED' },
    { label: 'Cama 4', status: 'OCCUPIED' },
  ])
  // Habitaciones privadas — una sola cama por habitación
  await recreateBeds(room101.id, [{ label: 'Cama 1', status: 'OCCUPIED' }])
  await recreateBeds(room102.id, [{ label: 'Cama 1', status: 'AVAILABLE' }])
  console.log('✅ Beds created')

  const hash = (password: string) => bcrypt.hash(password, 12)

  // Create supervisor
  const supervisor = await prisma.housekeepingStaff.upsert({
    where: { email: 'supervisor@demo.com' },
    update: {},
    create: {
      organizationId: org.id,
      propertyId: property.id,
      name: 'Ana García',
      email: 'supervisor@demo.com',
      passwordHash: await hash('supervisor123'),
      role: 'SUPERVISOR',
      capabilities: ['CLEANING', 'SANITIZATION', 'MAINTENANCE'],
    },
  })

  // Create receptionist
  const receptionist = await prisma.housekeepingStaff.upsert({
    where: { email: 'reception@demo.com' },
    update: {},
    create: {
      organizationId: org.id,
      propertyId: property.id,
      name: 'Carlos López',
      email: 'reception@demo.com',
      passwordHash: await hash('reception123'),
      role: 'RECEPTIONIST',
      capabilities: [],
    },
  })

  // Create housekeepers
  const hk1 = await prisma.housekeepingStaff.upsert({
    where: { email: 'hk1@demo.com' },
    update: {},
    create: {
      organizationId: org.id,
      propertyId: property.id,
      name: 'María Torres',
      email: 'hk1@demo.com',
      passwordHash: await hash('housekeeper123'),
      role: 'HOUSEKEEPER',
      capabilities: ['CLEANING', 'SANITIZATION'],
    },
  })

  await prisma.housekeepingStaff.upsert({
    where: { email: 'hk2@demo.com' },
    update: {},
    create: {
      organizationId: org.id,
      propertyId: property.id,
      name: 'Pedro Ramírez',
      email: 'hk2@demo.com',
      passwordHash: await hash('housekeeper123'),
      role: 'HOUSEKEEPER',
      capabilities: ['CLEANING', 'MAINTENANCE'],
    },
  })
  console.log('✅ Staff created')

  // Room Types
  const roomTypes = await Promise.all([
    prisma.roomType.upsert({
      where: { propertyId_code: { propertyId: property.id, code: 'STD' } },
      update: {},
      create: {
        organizationId: org.id,
        propertyId: property.id,
        name: 'Estándar',
        code: 'STD',
        maxOccupancy: 2,
        baseRate: 120,
        currency: 'USD',
        amenities: ['WiFi', 'AC', 'TV'],
      },
    }),
    prisma.roomType.upsert({
      where: { propertyId_code: { propertyId: property.id, code: 'JRS' } },
      update: {},
      create: {
        organizationId: org.id,
        propertyId: property.id,
        name: 'Junior Suite',
        code: 'JRS',
        maxOccupancy: 3,
        baseRate: 180,
        currency: 'USD',
        amenities: ['WiFi', 'AC', 'TV', 'Terrace', 'Ocean View'],
      },
    }),
    prisma.roomType.upsert({
      where: { propertyId_code: { propertyId: property.id, code: 'STE' } },
      update: {},
      create: {
        organizationId: org.id,
        propertyId: property.id,
        name: 'Suite Master',
        code: 'STE',
        maxOccupancy: 4,
        baseRate: 280,
        currency: 'USD',
        amenities: ['WiFi', 'AC', 'TV', 'Jacuzzi', 'Terrace', 'Ocean View'],
      },
    }),
  ])
  console.log('✅ Room types created')

  // Update rooms with status and roomTypeId
  const rooms = await prisma.room.findMany({ where: { propertyId: property.id } })
  for (let i = 0; i < rooms.length; i++) {
    const statuses: Array<'AVAILABLE' | 'OCCUPIED' | 'CLEANING'> = ['AVAILABLE', 'OCCUPIED', 'CLEANING', 'AVAILABLE']
    const typeIndex = i % roomTypes.length
    await prisma.room.update({
      where: { id: rooms[i].id },
      data: {
        status: statuses[i],
        roomTypeId: roomTypes[typeIndex].id,
      },
    })
  }
  console.log('✅ Rooms updated with types and statuses')

  // A GuestStay for the OCCUPIED room
  const occupiedRoom = rooms.find((_, i) => i === 1)
  if (occupiedRoom) {
    await prisma.guestStay.upsert({
      where: { id: 'demo-stay-001' },
      update: {},
      create: {
        id: 'demo-stay-001',
        organizationId: org.id,
        propertyId: property.id,
        roomId: occupiedRoom.id,
        guestName: 'Sarah Johnson',
        guestEmail: 'sarah@example.com',
        nationality: 'US',
        documentType: 'passport',
        documentNumber: 'AB123456',
        paxCount: 2,
        checkinAt: new Date(),
        scheduledCheckout: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        ratePerNight: 180,
        currency: 'USD',
        totalAmount: 540,
        amountPaid: 300,
        paymentStatus: 'PARTIAL',
        source: 'walk-in',
        checkedInById: receptionist.id,
      },
    })
    console.log('✅ Guest stay created')
  }

  console.log('\n📋 Seed credentials:')
  console.log(`  Supervisor:   supervisor@demo.com  / supervisor123`)
  console.log(`  Receptionist: reception@demo.com   / reception123`)
  console.log(`  Housekeeper:  hk1@demo.com         / housekeeper123`)
  console.log(`  Housekeeper:  hk2@demo.com         / housekeeper123`)
  console.log('\n✨ Seeding complete!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
