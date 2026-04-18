import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Create properties (seed-property-1 is the main demo; seed-property-2 exists
  // so the PropertySwitcher has something to switch to in a multi-property chain)
  const property = await prisma.property.upsert({
    where: { id: 'seed-property-1' },
    update: {},
    create: {
      id: 'seed-property-1',
      name: 'Hotel Demo',
    },
  })

  await prisma.property.upsert({
    where: { id: 'seed-property-2' },
    update: {},
    create: {
      id: 'seed-property-2',
      name: 'Hostal Centro',
    },
  })

  console.log(`✅ Properties: Hotel Demo, Hostal Centro`)

  // Create shared dorm rooms (hostal-style)
  const dorm1 = await prisma.room.upsert({
    where: { propertyId_number: { propertyId: property.id, number: 'Dorm1' } },
    update: {},
    create: {
      propertyId: property.id,
      number: 'Dorm1',
      floor: 1,
      type: 'SHARED',
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
      type: 'SHARED',
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
      type: 'PRIVATE',
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
      type: 'PRIVATE',
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
      propertyId: property.id,
      name: 'Pedro Ramírez',
      email: 'hk2@demo.com',
      passwordHash: await hash('housekeeper123'),
      role: 'HOUSEKEEPER',
      capabilities: ['CLEANING', 'MAINTENANCE'],
    },
  })
  console.log('✅ Staff created')

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
