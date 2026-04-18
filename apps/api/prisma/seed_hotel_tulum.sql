-- ================================================================
-- HOSPITALIDAD OS — SEED REALISTA v3
-- Hotel Tulum — Marzo / Abril / Mayo 2026
-- Cubre todos los flujos operacionales del PMS
--
-- CASOS DE USO INCLUIDOS:
-- 1. Estadías cross-month (marzo → abril)
-- 2. Completados recientes (apr 1-9)
-- 3. DEPARTING hoy (apr 10) — checkout pendiente
-- 4. ARRIVING hoy (apr 10) — walk-in y con reserva
-- 5. IN-HOUSE activos con distintos estados de pago
-- 6. Empresa / crédito corporativo
-- 7. Semana Santa alta ocupación (apr 13-20)
-- 8. Post Semana Santa ocupación media (apr 21-30)
-- 9. Reservas futuras confirmadas (mayo)
-- 10. StayJourneys multi-segmento:
--     - Extensión misma habitación
--     - Extensión habitación diferente
--     - Room move mid-stay
-- ================================================================

DO $$
DECLARE
  v_org_id   TEXT;
  v_prop_id  TEXT := 'prop-hotel-tulum-001';
  v_admin_id TEXT;
  v_room_id  TEXT;
  v_journey_id TEXT;
  v_segment_id TEXT;
  v_segment_id_2 TEXT;
BEGIN

  SELECT id INTO v_org_id
  FROM organizations
  WHERE id IN (
    SELECT organization_id FROM properties WHERE id = v_prop_id LIMIT 1
  )
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró organización para la propiedad %', v_prop_id;
  END IF;

  -- Look up the supervisor for "checked_in_by_id" / "actor_id" references.
  -- Original fixture hardcoded a UUID; using email keeps the seed portable
  -- across environments with different Prisma-generated UUIDs.
  SELECT id INTO v_admin_id
  FROM housekeeping_staff
  WHERE email = 'supervisor@demo.com'
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Staff supervisor@demo.com no existe — corre el seed TS primero';
  END IF;

  -- ================================================================
  -- LIMPIEZA — solo registros de ESTA propiedad (Hotel Tulum).
  -- Deja intactos los guest_stays/journeys de otras propiedades (p. ej.
  -- Hotel Cancún), que el seed TS agrega después.
  -- ================================================================
  DELETE FROM stay_journey_events WHERE journey_id IN (
    SELECT id FROM stay_journeys WHERE property_id = v_prop_id
  );
  DELETE FROM segment_nights WHERE segment_id IN (
    SELECT s.id FROM stay_segments s
    JOIN stay_journeys j ON s.journey_id = j.id
    WHERE j.property_id = v_prop_id
  );
  DELETE FROM stay_segments WHERE journey_id IN (
    SELECT id FROM stay_journeys WHERE property_id = v_prop_id
  );
  DELETE FROM stay_journeys WHERE property_id = v_prop_id;
  DELETE FROM guest_stays WHERE property_id = v_prop_id;

  RAISE NOTICE 'Tablas limpiadas correctamente';

  -- ================================================================
  -- HELPER: función inline para obtener room_id
  -- ================================================================

  -- ────────────────────────────────────────────────────────────────
  -- SECCIÓN 1 — CROSS-MONTH (llegaron en marzo, siguen en abril)
  -- ────────────────────────────────────────────────────────────────

  -- Elena Vasquez — A1 — Nómada digital larga estancia
  -- CASO ESPECIAL: tiene extensión (se crea como StayJourney después)
  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = 'A1' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout, actual_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-cm-a1-elena', v_org_id, v_prop_id, v_room_id,
    'Elena Vasquez', 'elena.v@remote.io', 1,
    '2026-03-28 15:00:00-05', '2026-04-14 12:00:00-05', NULL,
    130, 'USD', 2210, 910, 'PARTIAL',
    'direct', v_admin_id,
    'Nómada digital. Paga por semanas. Extensión aprobada hasta Apr 21.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- Marco Rossi — 301 — Completado, cruzó mes
  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '301' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout, actual_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-cm-301-marco', v_org_id, v_prop_id, v_room_id,
    'Marco Rossi', 'marco.rossi@gmail.com', 1,
    '2026-03-31 15:00:00-05', '2026-04-05 12:00:00-05',
    '2026-04-05 11:30:00-05',
    70, 'USD', 420, 420, 'PAID',
    'booking.com', v_admin_id,
    'Checkout completado. Reserva cruzó mes.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- Yuki Tanaka — B1 — Estancia larga, en Semana Santa
  -- CASO ESPECIAL: tiene extensión (se crea como StayJourney después)
  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = 'B1' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout, actual_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-cm-b1-yuki', v_org_id, v_prop_id, v_room_id,
    'Yuki Tanaka', 'yuki.t@design.jp', 1,
    '2026-03-25 15:00:00-05', '2026-04-18 12:00:00-05', NULL,
    130, 'USD', 3380, 1300, 'PARTIAL',
    'airbnb', v_admin_id,
    'Diseñadora freelance. Larga estancia. Extensión aprobada hasta Apr 25.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- ────────────────────────────────────────────────────────────────
  -- SECCIÓN 2 — COMPLETADOS APR 1-9
  -- ────────────────────────────────────────────────────────────────

  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '101' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, pax_count,
    checkin_at, scheduled_checkout, actual_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-apr-101-carlos', v_org_id, v_prop_id, v_room_id,
    'Carlos Mendoza', 2,
    '2026-04-01 15:00:00-05', '2026-04-05 12:00:00-05',
    '2026-04-05 10:45:00-05',
    90, 'USD', 360, 360, 'PAID',
    'booking.com', v_admin_id, 'Checkout completado.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '201' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout, actual_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-apr-201-sophie', v_org_id, v_prop_id, v_room_id,
    'Sophie Laurent', 'sophie.l@paris.fr', 1,
    '2026-04-03 15:00:00-05', '2026-04-08 12:00:00-05',
    '2026-04-08 11:00:00-05',
    90, 'USD', 450, 450, 'PAID',
    'expedia', v_admin_id, 'Checkout completado. OTA Expedia.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- Ahmed — sin pagar, ya checkout — caso de deuda
  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '302' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, pax_count,
    checkin_at, scheduled_checkout, actual_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-apr-302-ahmed', v_org_id, v_prop_id, v_room_id,
    'Ahmed Hassan', 1,
    '2026-04-05 15:00:00-05', '2026-04-09 12:00:00-05',
    '2026-04-09 13:00:00-05',
    70, 'USD', 280, 0, 'PENDING',
    'direct', v_admin_id,
    'DEUDA PENDIENTE — se fue sin pagar. Contactar.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- ────────────────────────────────────────────────────────────────
  -- SECCIÓN 3 — DEPARTING HOY (Apr 10)
  -- ────────────────────────────────────────────────────────────────

  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '102' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-dep-102-isabella', v_org_id, v_prop_id, v_room_id,
    'Isabella Romano', 'i.romano@milano.it', 2,
    '2026-04-07 15:00:00-05', '2026-04-10 12:00:00-05',
    90, 'USD', 270, 270, 'PAID',
    'direct', v_admin_id,
    'DEPARTING HOY. Checkout pendiente.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- James Wilson — CASO ESPECIAL: quiere extensión a 106 (se crea journey después)
  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '202' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-dep-202-james', v_org_id, v_prop_id, v_room_id,
    'James Wilson', 'j.wilson@london.uk', 1,
    '2026-04-08 15:00:00-05', '2026-04-10 12:00:00-05',
    90, 'USD', 180, 90, 'PARTIAL',
    'booking.com', v_admin_id,
    'DEPARTING HOY. Pago parcial. Solicitó extensión a hab 106.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '303' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, pax_count,
    checkin_at, scheduled_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-dep-303-fatima', v_org_id, v_prop_id, v_room_id,
    'Fatima Al-Rashid', 1,
    '2026-04-06 15:00:00-05', '2026-04-10 12:00:00-05',
    70, 'USD', 280, 280, 'PAID',
    'airbnb', v_admin_id,
    'DEPARTING HOY. Todo pagado.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- ────────────────────────────────────────────────────────────────
  -- SECCIÓN 4 — ARRIVING HOY (Apr 10)
  -- ────────────────────────────────────────────────────────────────

  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '103' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-arr-103-priya', v_org_id, v_prop_id, v_room_id,
    'Priya Sharma', 'priya.s@bangalore.in', 1,
    '2026-04-10 15:00:00-05', '2026-04-14 12:00:00-05',
    90, 'USD', 360, 180, 'PARTIAL',
    'booking.com', v_admin_id,
    'ARRIVING HOY. Pre-checkin completado. 50% pagado.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- Walk-in — llegó sin reserva
  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '203' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, pax_count,
    checkin_at, scheduled_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-arr-203-luca', v_org_id, v_prop_id, v_room_id,
    'Luca Ferrari', 1,
    '2026-04-10 16:00:00-05', '2026-04-13 12:00:00-05',
    90, 'USD', 270, 0, 'PENDING',
    'direct', v_admin_id,
    'WALK-IN. Sin reserva previa. Pago pendiente en recepción.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- Pareja luna de miel — cabaña premium, pagado completo
  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = 'A2' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-arr-a2-mitchell', v_org_id, v_prop_id, v_room_id,
    'Sarah & Tom Mitchell', 's.mitchell@email.com', 2,
    '2026-04-10 14:00:00-05', '2026-04-17 12:00:00-05',
    130, 'USD', 910, 910, 'PAID',
    'direct', v_admin_id,
    'LUNA DE MIEL. Cabaña premium. Pagado completo. Decoración especial.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- ────────────────────────────────────────────────────────────────
  -- SECCIÓN 5 — IN-HOUSE ACTIVOS
  -- ────────────────────────────────────────────────────────────────

  -- Diego — CASO ESPECIAL: room move hoy (104 → 205)
  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '104' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-ih-104-diego', v_org_id, v_prop_id, v_room_id,
    'Diego Hernández', 'd.hernandez@cdmx.mx', 1,
    '2026-04-08 15:00:00-05', '2026-04-12 12:00:00-05',
    90, 'USD', 360, 360, 'PAID',
    'expedia', v_admin_id,
    'IN-HOUSE. Reportó problema A/C. Room move a 205 ejecutado hoy.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '204' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-ih-204-mei', v_org_id, v_prop_id, v_room_id,
    'Mei Lin Chen', 'meilin@shanghai.cn', 1,
    '2026-04-09 15:00:00-05', '2026-04-15 12:00:00-05',
    90, 'USD', 540, 270, 'PARTIAL',
    'booking.com', v_admin_id,
    'IN-HOUSE. Semana Santa completa. Pago parcial.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- Olga — sin pago, in-house — caso crítico de cobro
  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '304' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, pax_count,
    checkin_at, scheduled_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-ih-304-olga', v_org_id, v_prop_id, v_room_id,
    'Olga Petrov', 1,
    '2026-04-07 15:00:00-05', '2026-04-11 12:00:00-05',
    70, 'USD', 280, 0, 'PENDING',
    'direct', v_admin_id,
    'IN-HOUSE. SIN PAGO — cobro urgente. Checkout mañana.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- Familia con niños — cabaña, Semana Santa
  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = 'C1' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-ih-c1-park', v_org_id, v_prop_id, v_room_id,
    'Robert & Amy Park', 'rpark@seoul.kr', 4,
    '2026-04-06 15:00:00-05', '2026-04-13 12:00:00-05',
    130, 'USD', 910, 910, 'PAID',
    'airbnb', v_admin_id,
    'Familia 4 personas. 2 niños. Cabaña. Todo pagado.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- Corporativo — cuenta empresa
  SELECT id INTO v_room_id FROM rooms
  WHERE "propertyId" = v_prop_id AND number = '105' LIMIT 1;
  INSERT INTO guest_stays(
    id, organization_id, property_id, room_id,
    guest_name, guest_email, pax_count,
    checkin_at, scheduled_checkout,
    rate_per_night, currency, total_amount, amount_paid, payment_status,
    source, checked_in_by_id, notes, created_at, updated_at
  ) VALUES (
    'stay-ih-105-corp', v_org_id, v_prop_id, v_room_id,
    'David Okonkwo', 'd.okonkwo@techcorp.com', 1,
    '2026-04-09 15:00:00-05', '2026-04-11 12:00:00-05',
    90, 'USD', 180, 0, 'CREDIT',
    'direct', v_admin_id,
    'CUENTA CORPORATIVA — Factura a TechCorp Inc. No cobrar directo.',
    NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  -- ────────────────────────────────────────────────────────────────
  -- SECCIÓN 6 — SEMANA SANTA (Apr 13-20) alta ocupación
  -- ────────────────────────────────────────────────────────────────

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='101' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-101-ana',v_org_id,v_prop_id,v_room_id,'Ana García','ana.g@madrid.es',2,'2026-04-13 15:00:00-05','2026-04-17 12:00:00-05',90,'USD',360,360,'PAID','booking.com',v_admin_id,'Semana Santa. Reserva anticipada.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='201' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-201-pierre',v_org_id,v_prop_id,v_room_id,'Pierre Dubois','p.dubois@lyon.fr',1,'2026-04-13 15:00:00-05','2026-04-20 12:00:00-05',90,'USD',630,270,'PARTIAL','expedia',v_admin_id,'Semana Santa completa. Pago parcial.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='301' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-301-lin',v_org_id,v_prop_id,v_room_id,'Lin Wei','linwei@beijing.cn',1,'2026-04-14 15:00:00-05','2026-04-18 12:00:00-05',70,'USD',280,280,'PAID','booking.com',v_admin_id,'Viajero solo. Habitación sencilla.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='102' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-102-maria',v_org_id,v_prop_id,v_room_id,'Maria Gonzalez',3,'2026-04-14 15:00:00-05','2026-04-21 12:00:00-05',90,'USD',630,0,'PENDING','direct',v_admin_id,'Familia. Reserva directa sin anticipo.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='202' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-202-jack',v_org_id,v_prop_id,v_room_id,'Jack Thompson','j.thompson@sydney.au',2,'2026-04-15 15:00:00-05','2026-04-19 12:00:00-05',90,'USD',360,360,'PAID','airbnb',v_admin_id,'Semana Santa. Airbnb.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='302' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-302-aisha',v_org_id,v_prop_id,v_room_id,'Aisha Diallo','aisha@dakar.sn',1,'2026-04-15 15:00:00-05','2026-04-20 12:00:00-05',70,'USD',350,140,'PARTIAL','booking.com',v_admin_id,'Semana Santa. Parcialmente pagado.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='A2' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-a2-hiroshi',v_org_id,v_prop_id,v_room_id,'Hiroshi Yamamoto','h.yama@tokyo.jp',2,'2026-04-17 15:00:00-05','2026-04-24 12:00:00-05',130,'USD',910,910,'PAID','direct',v_admin_id,'Cabaña premium. Pagado completo.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='B2' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-b2-nina',v_org_id,v_prop_id,v_room_id,'Nina Kowalski','nina.k@warsaw.pl',1,'2026-04-16 15:00:00-05','2026-04-23 12:00:00-05',130,'USD',910,520,'PARTIAL','expedia',v_admin_id,'Cabaña. Pago parcial.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='C2' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-c2-omar',v_org_id,v_prop_id,v_room_id,'Omar Khalil','o.khalil@dubai.ae',2,'2026-04-13 15:00:00-05','2026-04-20 12:00:00-05',130,'USD',910,910,'PAID','booking.com',v_admin_id,'Semana Santa completa. Cabaña. Pagado.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='103' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-103-emma',v_org_id,v_prop_id,v_room_id,'Emma Johnson','emma.j@nyc.us',1,'2026-04-18 15:00:00-05','2026-04-22 12:00:00-05',90,'USD',360,360,'PAID','booking.com',v_admin_id,'Fin de Semana Santa.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='203' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-203-carlos',v_org_id,v_prop_id,v_room_id,'Carlos Ruiz',2,'2026-04-19 15:00:00-05','2026-04-23 12:00:00-05',90,'USD',360,0,'PENDING','direct',v_admin_id,'Sin anticipo. Reserva directa.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='303' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-ss-303-yuna',v_org_id,v_prop_id,v_room_id,'Yuna Kim','yuna.k@seoul.kr',1,'2026-04-17 15:00:00-05','2026-04-21 12:00:00-05',70,'USD',280,280,'PAID','airbnb',v_admin_id,'K-pop tour. Airbnb.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  -- ────────────────────────────────────────────────────────────────
  -- SECCIÓN 7 — POST SEMANA SANTA (Apr 21-30)
  -- ────────────────────────────────────────────────────────────────

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='104' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-post-104-rafael',v_org_id,v_prop_id,v_room_id,'Rafael Torres','r.torres@bogota.co',1,'2026-04-21 15:00:00-05','2026-04-25 12:00:00-05',90,'USD',360,360,'PAID','booking.com',v_admin_id,NULL,NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='204' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-post-204-claire',v_org_id,v_prop_id,v_room_id,'Claire Martin','claire.m@paris.fr',1,'2026-04-22 15:00:00-05','2026-04-26 12:00:00-05',90,'USD',360,180,'PARTIAL','expedia',v_admin_id,NULL,NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='304' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-post-304-ivan',v_org_id,v_prop_id,v_room_id,'Ivan Petrov',1,'2026-04-23 15:00:00-05','2026-04-27 12:00:00-05',70,'USD',280,0,'PENDING','direct',v_admin_id,'Sin pago. Reserva directa.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='A1' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-post-a1-valentina',v_org_id,v_prop_id,v_room_id,'Valentina Cruz','vale.c@buenos.ar',1,'2026-04-24 15:00:00-05','2026-04-30 12:00:00-05',130,'USD',780,780,'PAID','airbnb',v_admin_id,'Cabaña post-temporada.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='105' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-post-105-ben',v_org_id,v_prop_id,v_room_id,'Ben Nakamura','ben.n@osaka.jp',1,'2026-04-25 15:00:00-05','2026-04-28 12:00:00-05',90,'USD',270,270,'PAID','booking.com',v_admin_id,NULL,NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='205' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-post-205-amina',v_org_id,v_prop_id,v_room_id,'Amina Traoré','amina.t@abidjan.ci',1,'2026-04-26 15:00:00-05','2026-04-30 12:00:00-05',90,'USD',360,0,'PENDING','direct',v_admin_id,'Primera visita. Sin anticipo.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='305' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-post-305-lucas',v_org_id,v_prop_id,v_room_id,'Lucas Schmidt','lucas.s@berlin.de',1,'2026-04-27 15:00:00-05','2026-04-30 12:00:00-05',70,'USD',210,210,'PAID','booking.com',v_admin_id,NULL,NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  -- ────────────────────────────────────────────────────────────────
  -- SECCIÓN 8 — MAYO (reservas futuras confirmadas)
  -- ────────────────────────────────────────────────────────────────

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='101' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-may-101-sofia',v_org_id,v_prop_id,v_room_id,'Sofía Martínez','sofia.m@lima.pe',1,'2026-05-01 15:00:00-05','2026-05-05 12:00:00-05',90,'USD',360,360,'PAID','booking.com',v_admin_id,'Reserva futura. Anticipado.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='201' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-may-201-thomas',v_org_id,v_prop_id,v_room_id,'Thomas Brown','t.brown@chicago.us',1,'2026-05-02 15:00:00-05','2026-05-07 12:00:00-05',90,'USD',450,0,'PENDING','expedia',v_admin_id,'Reserva futura. Sin anticipo.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='A1' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-may-a1-camille',v_org_id,v_prop_id,v_room_id,'Camille Moreau','camille.m@bordeaux.fr',2,'2026-05-03 15:00:00-05','2026-05-10 12:00:00-05',130,'USD',910,390,'PARTIAL','direct',v_admin_id,'Cabaña. Reserva directa. Anticipo 40%.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='301' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-may-301-kwame',v_org_id,v_prop_id,v_room_id,'Kwame Asante','kwame.a@accra.gh',1,'2026-05-05 15:00:00-05','2026-05-09 12:00:00-05',70,'USD',280,280,'PAID','airbnb',v_admin_id,'Reserva futura. Pagado.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='102' LIMIT 1;
  INSERT INTO guest_stays(id,organization_id,property_id,room_id,guest_name,guest_email,pax_count,checkin_at,scheduled_checkout,rate_per_night,currency,total_amount,amount_paid,payment_status,source,checked_in_by_id,notes,created_at,updated_at)
  VALUES('stay-may-102-ingrid',v_org_id,v_prop_id,v_room_id,'Ingrid Hansen','ingrid.h@oslo.no',1,'2026-05-08 15:00:00-05','2026-05-12 12:00:00-05',90,'USD',360,0,'PENDING','booking.com',v_admin_id,'Reserva futura sin anticipo.',NOW(),NOW()) ON CONFLICT(id) DO NOTHING;

  RAISE NOTICE 'guest_stays insertados correctamente';

  -- ================================================================
  -- SECCIÓN 9 — STAY JOURNEYS MULTI-SEGMENTO
  -- Los 4 casos que demuestran extensiones y room moves
  -- ================================================================

  -- ────────────────────────────────────────────────────────────────
  -- JOURNEY 1: Elena Vasquez — Extensión misma habitación (A1)
  -- Original: Mar 28 → Apr 14 | Extensión: Apr 14 → Apr 21
  -- ────────────────────────────────────────────────────────────────
  v_journey_id := gen_random_uuid()::TEXT;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='A1' LIMIT 1;

  INSERT INTO stay_journeys(id,organization_id,property_id,guest_stay_id,guest_name,guest_email,status,journey_check_in,journey_check_out,created_at,updated_at)
  VALUES(v_journey_id,v_org_id,v_prop_id,'stay-cm-a1-elena','Elena Vasquez','elena.v@remote.io','ACTIVE','2026-03-28','2026-04-21',NOW(),NOW());

  -- Segmento 1: original (parcialmente locked — noches antes de hoy)
  v_segment_id := gen_random_uuid()::TEXT;
  INSERT INTO stay_segments(id,journey_id,room_id,guest_stay_id,check_in,check_out,status,locked,reason,rate_snapshot,created_at,updated_at)
  VALUES(v_segment_id,v_journey_id,v_room_id,'stay-cm-a1-elena','2026-03-28','2026-04-14','ACTIVE',false,'ORIGINAL',130,NOW(),NOW());

  -- Noches del segmento 1 (Mar 28 → Apr 13 locked, Apr 10-13 pending)
  INSERT INTO segment_nights(id,segment_id,date,rate,status,locked)
  SELECT gen_random_uuid()::TEXT, v_segment_id, gs::date, 130,
    CASE WHEN gs < '2026-04-10'::date THEN 'LOCKED'::night_status ELSE 'PENDING'::night_status END,
    gs < '2026-04-10'::date
  FROM generate_series('2026-03-28'::date, '2026-04-13'::date, '1 day'::interval) gs;

  -- Segmento 2: extensión misma habitación
  v_segment_id_2 := gen_random_uuid()::TEXT;
  INSERT INTO stay_segments(id,journey_id,room_id,check_in,check_out,status,locked,reason,rate_snapshot,created_at,updated_at)
  VALUES(v_segment_id_2,v_journey_id,v_room_id,'2026-04-14','2026-04-21','PENDING',false,'EXTENSION_SAME_ROOM',130,NOW(),NOW());

  INSERT INTO segment_nights(id,segment_id,date,rate,status,locked)
  SELECT gen_random_uuid()::TEXT, v_segment_id_2, gs::date, 130,
    'PENDING'::night_status, false
  FROM generate_series('2026-04-14'::date, '2026-04-20'::date, '1 day'::interval) gs;

  INSERT INTO stay_journey_events(id,journey_id,event_type,actor_id,payload,occurred_at)
  VALUES(gen_random_uuid()::TEXT,v_journey_id,'JOURNEY_CREATED',NULL,'{"source":"seed_v3"}',NOW()),
        (gen_random_uuid()::TEXT,v_journey_id,'EXTENSION_APPROVED',v_admin_id,
         '{"reason":"EXTENSION_SAME_ROOM","previousCheckOut":"2026-04-14","newCheckOut":"2026-04-21"}',NOW());

  -- ────────────────────────────────────────────────────────────────
  -- JOURNEY 2: James Wilson — Extensión habitación diferente (202 → 106)
  -- Original: Apr 8 → Apr 10 | Extensión: Apr 10 → Apr 13 en 106
  -- ────────────────────────────────────────────────────────────────
  v_journey_id := gen_random_uuid()::TEXT;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='202' LIMIT 1;

  INSERT INTO stay_journeys(id,organization_id,property_id,guest_stay_id,guest_name,guest_email,status,journey_check_in,journey_check_out,created_at,updated_at)
  VALUES(v_journey_id,v_org_id,v_prop_id,'stay-dep-202-james','James Wilson','j.wilson@london.uk','ACTIVE','2026-04-08','2026-04-13',NOW(),NOW());

  -- Segmento 1: original en 202 (completado, locked)
  v_segment_id := gen_random_uuid()::TEXT;
  INSERT INTO stay_segments(id,journey_id,room_id,guest_stay_id,check_in,check_out,status,locked,reason,rate_snapshot,created_at,updated_at)
  VALUES(v_segment_id,v_journey_id,v_room_id,'stay-dep-202-james','2026-04-08','2026-04-10','COMPLETED',true,'ORIGINAL',90,NOW(),NOW());

  INSERT INTO segment_nights(id,segment_id,date,rate,status,locked)
  VALUES(gen_random_uuid()::TEXT,v_segment_id,'2026-04-08',90,'LOCKED',true),
        (gen_random_uuid()::TEXT,v_segment_id,'2026-04-09',90,'LOCKED',true);

  -- Segmento 2: extensión en 106
  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='106' LIMIT 1;
  v_segment_id_2 := gen_random_uuid()::TEXT;
  INSERT INTO stay_segments(id,journey_id,room_id,check_in,check_out,status,locked,reason,rate_snapshot,created_at,updated_at)
  VALUES(v_segment_id_2,v_journey_id,v_room_id,'2026-04-10','2026-04-13','ACTIVE',false,'EXTENSION_NEW_ROOM',90,NOW(),NOW());

  INSERT INTO segment_nights(id,segment_id,date,rate,status,locked)
  VALUES(gen_random_uuid()::TEXT,v_segment_id_2,'2026-04-10',90,'PENDING',false),
        (gen_random_uuid()::TEXT,v_segment_id_2,'2026-04-11',90,'PENDING',false),
        (gen_random_uuid()::TEXT,v_segment_id_2,'2026-04-12',90,'PENDING',false);

  INSERT INTO stay_journey_events(id,journey_id,event_type,actor_id,payload,occurred_at)
  VALUES(gen_random_uuid()::TEXT,v_journey_id,'JOURNEY_CREATED',NULL,'{"source":"seed_v3"}',NOW()),
        (gen_random_uuid()::TEXT,v_journey_id,'EXTENSION_APPROVED',v_admin_id,
         '{"reason":"EXTENSION_NEW_ROOM","previousRoomId":"202","newRoomId":"106","newCheckOut":"2026-04-13"}',NOW());

  -- ────────────────────────────────────────────────────────────────
  -- JOURNEY 3: Diego Hernández — Room move mid-stay (104 → 205)
  -- Original: Apr 8 → Apr 12 | Move efectivo: Apr 10 (hoy)
  -- ────────────────────────────────────────────────────────────────
  v_journey_id := gen_random_uuid()::TEXT;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='104' LIMIT 1;

  INSERT INTO stay_journeys(id,organization_id,property_id,guest_stay_id,guest_name,guest_email,status,journey_check_in,journey_check_out,created_at,updated_at)
  VALUES(v_journey_id,v_org_id,v_prop_id,'stay-ih-104-diego','Diego Hernández','d.hernandez@cdmx.mx','ACTIVE','2026-04-08','2026-04-12',NOW(),NOW());

  -- Segmento 1: 104, Apr 8-9 (locked, completado por room move)
  v_segment_id := gen_random_uuid()::TEXT;
  INSERT INTO stay_segments(id,journey_id,room_id,guest_stay_id,check_in,check_out,status,locked,reason,rate_snapshot,created_at,updated_at)
  VALUES(v_segment_id,v_journey_id,v_room_id,'stay-ih-104-diego','2026-04-08','2026-04-10','COMPLETED',true,'ORIGINAL',90,NOW(),NOW());

  INSERT INTO segment_nights(id,segment_id,date,rate,status,locked)
  VALUES(gen_random_uuid()::TEXT,v_segment_id,'2026-04-08',90,'LOCKED',true),
        (gen_random_uuid()::TEXT,v_segment_id,'2026-04-09',90,'LOCKED',true);

  -- Segmento 2: 205, Apr 10-11 (activo, room move)
  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='205' LIMIT 1;
  v_segment_id_2 := gen_random_uuid()::TEXT;
  INSERT INTO stay_segments(id,journey_id,room_id,check_in,check_out,status,locked,reason,rate_snapshot,created_at,updated_at)
  VALUES(v_segment_id_2,v_journey_id,v_room_id,'2026-04-10','2026-04-12','ACTIVE',false,'ROOM_MOVE',90,NOW(),NOW());

  INSERT INTO segment_nights(id,segment_id,date,rate,status,locked)
  VALUES(gen_random_uuid()::TEXT,v_segment_id_2,'2026-04-10',90,'PENDING',false),
        (gen_random_uuid()::TEXT,v_segment_id_2,'2026-04-11',90,'PENDING',false);

  INSERT INTO stay_journey_events(id,journey_id,event_type,actor_id,payload,occurred_at)
  VALUES(gen_random_uuid()::TEXT,v_journey_id,'JOURNEY_CREATED',NULL,'{"source":"seed_v3"}',NOW()),
        (gen_random_uuid()::TEXT,v_journey_id,'ROOM_MOVE_EXECUTED',v_admin_id,
         '{"fromRoomNumber":"104","toRoomNumber":"205","effectiveDate":"2026-04-10","reason":"Falla A/C"}',NOW());

  -- ────────────────────────────────────────────────────────────────
  -- JOURNEY 4: Yuki Tanaka — Extensión misma habitación (B1)
  -- Original: Mar 25 → Apr 18 | Extensión: Apr 18 → Apr 25
  -- ────────────────────────────────────────────────────────────────
  v_journey_id := gen_random_uuid()::TEXT;

  SELECT id INTO v_room_id FROM rooms WHERE "propertyId"=v_prop_id AND number='B1' LIMIT 1;

  INSERT INTO stay_journeys(id,organization_id,property_id,guest_stay_id,guest_name,guest_email,status,journey_check_in,journey_check_out,created_at,updated_at)
  VALUES(v_journey_id,v_org_id,v_prop_id,'stay-cm-b1-yuki','Yuki Tanaka','yuki.t@design.jp','ACTIVE','2026-03-25','2026-04-25',NOW(),NOW());

  -- Segmento 1: original Mar 25 → Apr 18
  v_segment_id := gen_random_uuid()::TEXT;
  INSERT INTO stay_segments(id,journey_id,room_id,guest_stay_id,check_in,check_out,status,locked,reason,rate_snapshot,created_at,updated_at)
  VALUES(v_segment_id,v_journey_id,v_room_id,'stay-cm-b1-yuki','2026-03-25','2026-04-18','ACTIVE',false,'ORIGINAL',130,NOW(),NOW());

  INSERT INTO segment_nights(id,segment_id,date,rate,status,locked)
  SELECT gen_random_uuid()::TEXT, v_segment_id, gs::date, 130,
    CASE WHEN gs < '2026-04-10'::date THEN 'LOCKED'::night_status ELSE 'PENDING'::night_status END,
    gs < '2026-04-10'::date
  FROM generate_series('2026-03-25'::date, '2026-04-17'::date, '1 day'::interval) gs;

  -- Segmento 2: extensión Apr 18 → Apr 25
  v_segment_id_2 := gen_random_uuid()::TEXT;
  INSERT INTO stay_segments(id,journey_id,room_id,check_in,check_out,status,locked,reason,rate_snapshot,created_at,updated_at)
  VALUES(v_segment_id_2,v_journey_id,v_room_id,'2026-04-18','2026-04-25','PENDING',false,'EXTENSION_SAME_ROOM',130,NOW(),NOW());

  INSERT INTO segment_nights(id,segment_id,date,rate,status,locked)
  SELECT gen_random_uuid()::TEXT, v_segment_id_2, gs::date, 130,
    'PENDING'::night_status, false
  FROM generate_series('2026-04-18'::date, '2026-04-24'::date, '1 day'::interval) gs;

  INSERT INTO stay_journey_events(id,journey_id,event_type,actor_id,payload,occurred_at)
  VALUES(gen_random_uuid()::TEXT,v_journey_id,'JOURNEY_CREATED',NULL,'{"source":"seed_v3"}',NOW()),
        (gen_random_uuid()::TEXT,v_journey_id,'EXTENSION_APPROVED',v_admin_id,
         '{"reason":"EXTENSION_SAME_ROOM","previousCheckOut":"2026-04-18","newCheckOut":"2026-04-25"}',NOW());

  RAISE NOTICE 'StayJourneys multi-segmento insertados correctamente';

  -- ================================================================
  -- VERIFICACIÓN FINAL
  -- ================================================================
  RAISE NOTICE '=== CONTEOS FINALES ===';
  RAISE NOTICE 'guest_stays: %',      (SELECT COUNT(*) FROM guest_stays);
  RAISE NOTICE 'stay_journeys: %',    (SELECT COUNT(*) FROM stay_journeys);
  RAISE NOTICE 'stay_segments: %',    (SELECT COUNT(*) FROM stay_segments);
  RAISE NOTICE 'segment_nights: %',   (SELECT COUNT(*) FROM segment_nights);
  RAISE NOTICE 'journey_events: %',   (SELECT COUNT(*) FROM stay_journey_events);

END $$;
