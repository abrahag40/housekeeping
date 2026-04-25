import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Zenix seed — organización "Zenix Demo" con DOS hoteles del mismo tenant:
 *
 *   1. Hotel Tulum  (prop-hotel-tulum-001) — 17 habitaciones en 3 pisos +
 *      cabañas. Recibe el set completo de escenarios operativos (41
 *      estadías, 4 StayJourneys multi-segmento, cross-month, Semana Santa,
 *      etc.) vía el fixture SQL `seed_hotel_tulum.sql`.
 *
 *   2. Hotel Cancún (prop-hotel-cancun-001) — 8 habitaciones, sirve de
 *      banco de pruebas para aislamiento entre propiedades. Tiene un
 *      subset curado de casos (past, in-house, arriving, extension).
 *
 * Credenciales de acceso (todas activas):
 *   supervisor@demo.com   / supervisor123   (Tulum)
 *   reception@demo.com    / reception123    (Tulum)
 *   hk1@demo.com          / housekeeper123  (Tulum)
 *   hk2@demo.com          / housekeeper123  (Tulum)
 *   reception.cun@demo.com / reception123   (Cancún)
 *   hk3@demo.com          / housekeeper123  (Cancún)
 */

const prisma = new PrismaClient()
const hash = (pw: string) => bcrypt.hash(pw, 12)

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Days-offset helper for constructing guest-stay check-in/out timestamps
 * relative to the current date. All times normalize to noon UTC so they sit
 * inside the timeline grid regardless of local timezone.
 */
function daysFromNow(days: number, hour = 12): Date {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Zenix seed — starting…\n')

  // 0. CLEANUP LEGACY (phase 1 — delete data that doesn't gate on the new
  // property existing). Previous seeds used `seed-property-1`; retire it
  // so the timeline shows only the Tulum/Cancún dataset. Phase 2 (deleting
  // the property row itself) runs later, after the new properties exist
  // and staff have been re-homed.
  const legacyPropertyId = 'seed-property-1'
  await prisma.guestStay.deleteMany({ where: { propertyId: legacyPropertyId } })
  await prisma.cleaningTask.deleteMany({ where: { unit: { room: { propertyId: legacyPropertyId } } } })
  await prisma.unit.deleteMany({ where: { room: { propertyId: legacyPropertyId } } })
  await prisma.room.deleteMany({ where: { propertyId: legacyPropertyId } })
  await prisma.roomType.deleteMany({ where: { propertyId: legacyPropertyId } })
  await prisma.propertySettings.deleteMany({ where: { propertyId: legacyPropertyId } })

  // 1. ORGANIZATION ─────────────────────────────────────────────────────────
  // Upsert by id so re-running the seed renames the old `demo-org` → `zenix-demo`
  // in-place without creating a second tenant.
  const org = await prisma.organization.upsert({
    where: { id: 'seed-org-1' },
    update: { name: 'Zenix Demo', slug: 'zenix-demo' },
    create: {
      id: 'seed-org-1',
      name: 'Zenix Demo',
      slug: 'zenix-demo',
      plan: 'STARTER',
      countryCode: 'MX',
      timezone: 'America/Cancun',
      currency: 'USD',
    },
  })
  console.log(`✅ Org: ${org.name}`)

  // 2. PROPERTIES ───────────────────────────────────────────────────────────
  const tulum = await prisma.property.upsert({
    where: { id: 'prop-hotel-tulum-001' },
    update: { name: 'Hotel Tulum', region: 'Riviera Maya', city: 'Tulum' },
    create: {
      id: 'prop-hotel-tulum-001',
      organizationId: org.id,
      name: 'Hotel Tulum',
      type: 'HOTEL',
      region: 'Riviera Maya',
      city: 'Tulum',
    },
  })
  const cancun = await prisma.property.upsert({
    where: { id: 'prop-hotel-cancun-001' },
    update: { name: 'Hotel Cancún', region: 'Zona Hotelera Cancún', city: 'Cancún' },
    create: {
      id: 'prop-hotel-cancun-001',
      organizationId: org.id,
      name: 'Hotel Cancún',
      type: 'HOTEL',
      region: 'Zona Hotelera Cancún',
      city: 'Cancún',
    },
  })
  console.log(`✅ Properties: ${tulum.name}, ${cancun.name}`)

  // 3. ROOM TYPES ───────────────────────────────────────────────────────────

  async function upsertRoomType(args: {
    propertyId: string
    name: string
    code: string
    maxOccupancy: number
    baseRate: number
    amenities: string[]
  }) {
    return prisma.roomType.upsert({
      where: { propertyId_code: { propertyId: args.propertyId, code: args.code } },
      update: {
        name: args.name,
        maxOccupancy: args.maxOccupancy,
        baseRate: args.baseRate,
        amenities: args.amenities,
      },
      create: {
        organizationId: org.id,
        propertyId: args.propertyId,
        name: args.name,
        code: args.code,
        maxOccupancy: args.maxOccupancy,
        baseRate: args.baseRate,
        currency: 'USD',
        amenities: args.amenities,
      },
    })
  }

  const [tStd, tSup, tJrSuite, tSuite, tCabin] = await Promise.all([
    upsertRoomType({ propertyId: tulum.id, name: 'Estándar',    code: 'STD', maxOccupancy: 2, baseRate:  70, amenities: ['WiFi', 'AC', 'TV'] }),
    upsertRoomType({ propertyId: tulum.id, name: 'Superior',    code: 'SUP', maxOccupancy: 2, baseRate: 110, amenities: ['WiFi', 'AC', 'TV', 'Minibar'] }),
    upsertRoomType({ propertyId: tulum.id, name: 'Junior Suite', code: 'JRS', maxOccupancy: 3, baseRate: 180, amenities: ['WiFi', 'AC', 'TV', 'Balcón'] }),
    upsertRoomType({ propertyId: tulum.id, name: 'Suite',        code: 'STE', maxOccupancy: 4, baseRate: 280, amenities: ['WiFi', 'AC', 'TV', 'Jacuzzi', 'Balcón'] }),
    upsertRoomType({ propertyId: tulum.id, name: 'Cabaña',       code: 'CAB', maxOccupancy: 2, baseRate: 130, amenities: ['WiFi', 'Fan', 'Hammock', 'Private garden'] }),
  ])

  const [cStd, cSup, cSuite] = await Promise.all([
    upsertRoomType({ propertyId: cancun.id, name: 'Estándar', code: 'STD', maxOccupancy: 2, baseRate: 100, amenities: ['WiFi', 'AC', 'TV'] }),
    upsertRoomType({ propertyId: cancun.id, name: 'Superior', code: 'SUP', maxOccupancy: 3, baseRate: 150, amenities: ['WiFi', 'AC', 'TV', 'Ocean View'] }),
    upsertRoomType({ propertyId: cancun.id, name: 'Suite',    code: 'STE', maxOccupancy: 4, baseRate: 250, amenities: ['WiFi', 'AC', 'TV', 'Jacuzzi', 'Ocean View'] }),
  ])
  console.log(`✅ RoomTypes: Tulum(${5}), Cancún(${3})`)

  // 4. ROOMS ────────────────────────────────────────────────────────────────

  async function upsertRoom(args: {
    propertyId: string
    number: string
    floor: number | null
    category: 'PRIVATE' | 'SHARED'
    capacity: number
    roomTypeId: string
    status?: 'AVAILABLE' | 'OCCUPIED' | 'CLEANING'
  }) {
    return prisma.room.upsert({
      where: { propertyId_number: { propertyId: args.propertyId, number: args.number } },
      update: { floor: args.floor, capacity: args.capacity, roomTypeId: args.roomTypeId },
      create: {
        organizationId: org.id,
        propertyId: args.propertyId,
        number: args.number,
        floor: args.floor,
        category: args.category,
        capacity: args.capacity,
        roomTypeId: args.roomTypeId,
        status: args.status ?? 'AVAILABLE',
      },
    })
  }

  // Hotel Tulum — 22 rooms matching the SQL fixture expectations.
  // Floor 1 (101-106) STD · Floor 2 (201-205) SUP · Floor 3 (301-305) JRS
  // Cabanas A1/A2 CAB · Villas B1/B2 STE · Premium C1/C2 STE
  const tulumRoomSpecs: Array<Parameters<typeof upsertRoom>[0]> = [
    { propertyId: tulum.id, number: '101', floor: 1, category: 'PRIVATE', capacity: 2, roomTypeId: tStd.id },
    { propertyId: tulum.id, number: '102', floor: 1, category: 'PRIVATE', capacity: 2, roomTypeId: tStd.id },
    { propertyId: tulum.id, number: '103', floor: 1, category: 'PRIVATE', capacity: 2, roomTypeId: tStd.id },
    { propertyId: tulum.id, number: '104', floor: 1, category: 'PRIVATE', capacity: 2, roomTypeId: tStd.id },
    { propertyId: tulum.id, number: '105', floor: 1, category: 'PRIVATE', capacity: 2, roomTypeId: tStd.id },
    { propertyId: tulum.id, number: '106', floor: 1, category: 'PRIVATE', capacity: 2, roomTypeId: tStd.id },
    { propertyId: tulum.id, number: '201', floor: 2, category: 'PRIVATE', capacity: 2, roomTypeId: tSup.id },
    { propertyId: tulum.id, number: '202', floor: 2, category: 'PRIVATE', capacity: 2, roomTypeId: tSup.id },
    { propertyId: tulum.id, number: '203', floor: 2, category: 'PRIVATE', capacity: 2, roomTypeId: tSup.id },
    { propertyId: tulum.id, number: '204', floor: 2, category: 'PRIVATE', capacity: 2, roomTypeId: tSup.id },
    { propertyId: tulum.id, number: '205', floor: 2, category: 'PRIVATE', capacity: 2, roomTypeId: tSup.id },
    { propertyId: tulum.id, number: '301', floor: 3, category: 'PRIVATE', capacity: 3, roomTypeId: tJrSuite.id },
    { propertyId: tulum.id, number: '302', floor: 3, category: 'PRIVATE', capacity: 3, roomTypeId: tJrSuite.id },
    { propertyId: tulum.id, number: '303', floor: 3, category: 'PRIVATE', capacity: 3, roomTypeId: tJrSuite.id },
    { propertyId: tulum.id, number: '304', floor: 3, category: 'PRIVATE', capacity: 3, roomTypeId: tJrSuite.id },
    { propertyId: tulum.id, number: '305', floor: 3, category: 'PRIVATE', capacity: 3, roomTypeId: tJrSuite.id },
    { propertyId: tulum.id, number: 'A1',  floor: 0, category: 'PRIVATE', capacity: 2, roomTypeId: tCabin.id },
    { propertyId: tulum.id, number: 'A2',  floor: 0, category: 'PRIVATE', capacity: 2, roomTypeId: tCabin.id },
    { propertyId: tulum.id, number: 'B1',  floor: 0, category: 'PRIVATE', capacity: 4, roomTypeId: tSuite.id },
    { propertyId: tulum.id, number: 'B2',  floor: 0, category: 'PRIVATE', capacity: 4, roomTypeId: tSuite.id },
    { propertyId: tulum.id, number: 'C1',  floor: 0, category: 'PRIVATE', capacity: 4, roomTypeId: tSuite.id },
    { propertyId: tulum.id, number: 'C2',  floor: 0, category: 'PRIVATE', capacity: 4, roomTypeId: tSuite.id },
  ]
  await Promise.all(tulumRoomSpecs.map(upsertRoom))

  // Hotel Cancún — 8 rooms, smaller property for multi-property testing.
  const cancunRoomSpecs: Array<Parameters<typeof upsertRoom>[0]> = [
    { propertyId: cancun.id, number: '201', floor: 2, category: 'PRIVATE', capacity: 2, roomTypeId: cStd.id },
    { propertyId: cancun.id, number: '202', floor: 2, category: 'PRIVATE', capacity: 2, roomTypeId: cStd.id },
    { propertyId: cancun.id, number: '203', floor: 2, category: 'PRIVATE', capacity: 2, roomTypeId: cStd.id },
    { propertyId: cancun.id, number: '204', floor: 2, category: 'PRIVATE', capacity: 2, roomTypeId: cStd.id },
    { propertyId: cancun.id, number: '301', floor: 3, category: 'PRIVATE', capacity: 3, roomTypeId: cSup.id },
    { propertyId: cancun.id, number: '302', floor: 3, category: 'PRIVATE', capacity: 3, roomTypeId: cSup.id },
    { propertyId: cancun.id, number: '401', floor: 4, category: 'PRIVATE', capacity: 4, roomTypeId: cSuite.id },
    { propertyId: cancun.id, number: '402', floor: 4, category: 'PRIVATE', capacity: 4, roomTypeId: cSuite.id },
  ]
  const cancunRooms = await Promise.all(cancunRoomSpecs.map(upsertRoom))
  console.log(`✅ Rooms: Tulum(${tulumRoomSpecs.length}), Cancún(${cancunRoomSpecs.length})`)

  // 5. STAFF ────────────────────────────────────────────────────────────────

  async function upsertStaff(args: {
    email: string
    name: string
    password: string
    role: 'SUPERVISOR' | 'RECEPTIONIST' | 'HOUSEKEEPER'
    propertyId: string
    capabilities?: Array<'CLEANING' | 'SANITIZATION' | 'MAINTENANCE'>
  }) {
    return prisma.housekeepingStaff.upsert({
      where: { email: args.email },
      update: { propertyId: args.propertyId, organizationId: org.id },
      create: {
        organizationId: org.id,
        propertyId: args.propertyId,
        email: args.email,
        name: args.name,
        passwordHash: await hash(args.password),
        role: args.role,
        capabilities: args.capabilities ?? [],
      },
    })
  }

  const supervisor  = await upsertStaff({ email: 'supervisor@demo.com',     name: 'Ana García',     password: 'supervisor123', role: 'SUPERVISOR',   propertyId: tulum.id,  capabilities: ['CLEANING', 'SANITIZATION', 'MAINTENANCE'] })
  const reception   = await upsertStaff({ email: 'reception@demo.com',      name: 'Carlos López',   password: 'reception123',  role: 'RECEPTIONIST', propertyId: tulum.id })
  await                   upsertStaff({ email: 'hk1@demo.com',              name: 'María Torres',   password: 'housekeeper123',role: 'HOUSEKEEPER',  propertyId: tulum.id,  capabilities: ['CLEANING', 'SANITIZATION'] })
  await                   upsertStaff({ email: 'hk2@demo.com',              name: 'Pedro Ramírez',  password: 'housekeeper123',role: 'HOUSEKEEPER',  propertyId: tulum.id,  capabilities: ['CLEANING', 'MAINTENANCE'] })
  const receptionC  = await upsertStaff({ email: 'reception.cun@demo.com',  name: 'Laura Mendez',   password: 'reception123',  role: 'RECEPTIONIST', propertyId: cancun.id })
  await                   upsertStaff({ email: 'hk3@demo.com',              name: 'Luis Herrera',   password: 'housekeeper123',role: 'HOUSEKEEPER',  propertyId: cancun.id, capabilities: ['CLEANING'] })
  console.log(`✅ Staff: 6 cuentas (4 Tulum, 2 Cancún); supervisor global = ${supervisor.email}`)

  // 5b. CLEANUP LEGACY (phase 2) ────────────────────────────────────────────
  // Now that Tulum exists and staff have been re-homed via the
  // upsertStaff.update path above, we can delete the retired property.
  await prisma.housekeepingStaff.updateMany({
    where: { propertyId: legacyPropertyId },
    data:  { propertyId: tulum.id },
  })
  await prisma.property.deleteMany({ where: { id: legacyPropertyId } })

  // 6. PROPERTY SETTINGS ───────────────────────────────────────────────────
  for (const p of [tulum, cancun]) {
    await prisma.propertySettings.upsert({
      where: { propertyId: p.id },
      update: {},
      create: {
        organizationId: org.id,
        propertyId: p.id,
        timezone: 'America/Cancun',
      },
    })
  }

  // 7. TULUM GUEST DATA — run the SQL fixture ──────────────────────────────
  const sqlPath = path.join(__dirname, 'seed_hotel_tulum_v5.sql')
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf8')
    console.log(`\n🏖  Loading Hotel Tulum fixture (${sql.length.toLocaleString()} chars)…`)
    await prisma.$executeRawUnsafe(sql)
    const [{ count: tulumStays }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM guest_stays WHERE property_id = $1`,
      tulum.id,
    )
    const [{ count: tulumJourneys }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM stay_journeys WHERE property_id = $1`,
      tulum.id,
    )
    console.log(`   Tulum: ${tulumStays} stays · ${tulumJourneys} journeys`)
  } else {
    console.warn(`⚠️  ${sqlPath} not found — Tulum timeline will be empty`)
  }

  // 8. CANCÚN GUEST DATA — run the SQL fixture ─────────────────────────────

  const sqlCancunPath = path.join(__dirname, 'seed_hotel_cancun_v3.sql')
  if (fs.existsSync(sqlCancunPath)) {
    const sqlCancun = fs.readFileSync(sqlCancunPath, 'utf8')
    console.log(`\n🏙  Loading Hotel Cancún fixture (${sqlCancun.length.toLocaleString()} chars)…`)
    await prisma.$executeRawUnsafe(sqlCancun)
    const [{ count: cancunStayCount }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM guest_stays WHERE property_id = $1`,
      cancun.id,
    )
    const [{ count: cancunJourneys }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM stay_journeys WHERE property_id = $1`,
      cancun.id,
    )
    console.log(`   Cancún: ${cancunStayCount} stays · ${cancunJourneys} journeys`)
  } else {
    console.warn(`⚠️  ${sqlCancunPath} not found — Cancún timeline will be empty`)
  }


  // ── Final summary ─────────────────────────────────────────────────────────
  console.log('\n📋 Credenciales:')
  console.log('  supervisor@demo.com      / supervisor123    (Supervisor · Tulum)')
  console.log('  reception@demo.com       / reception123     (Recepción · Tulum)')
  console.log('  hk1@demo.com             / housekeeper123   (Housekeeping · Tulum)')
  console.log('  hk2@demo.com             / housekeeper123   (Housekeeping · Tulum)')
  console.log('  reception.cun@demo.com   / reception123     (Recepción · Cancún)')
  console.log('  hk3@demo.com             / housekeeper123   (Housekeeping · Cancún)')
  console.log('\n✨ Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
