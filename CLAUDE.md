# CLAUDE.md — Housekeeping Management System

> Guía para retomar el proyecto desde cero. Lee esto antes de tocar código.
> Última actualización: 2026-03-21 (Sesión 3 — Etapa 1 completa).

---

## Project Overview

Sistema de gestión de housekeeping para hostales/hoteles con dormitorios compartidos y habitaciones privadas. Reemplaza el proceso en papel: el recepcionista planifica las salidas del día, confirma cuando el huésped sale físicamente, y housekeeping recibe notificaciones push para limpiar.

**El flujo operativo central (Etapa 1 — COMPLETO):**
```
07:00 Recepcionista abre app web → marca qué camas tienen salida hoy → Confirmar
      ↓ POST /checkouts/batch → CleaningTask(PENDING) × cama — sin notificaciones aún
11:00 Huésped llega a recepción — entrega llave
      ↓ Recepcionista toca su cama en "Tiempo Real" → modal → Confirmar salida
      ↓ POST /checkouts/:id/depart?bedId=X → PENDING→DIRTY, push a housekeeping
      ↓ Camarera recibe notificación push en app móvil
      ↓ Camarera: Iniciar → Finalizar → Supervisor verifica
```

---

## Tech Stack

### Monorepo (Turborepo)
| App | Framework | Puerto |
|-----|-----------|--------|
| `apps/api` | NestJS 10 + Prisma + PostgreSQL | 3000 |
| `apps/web` | React 18 + Vite + Tailwind CSS | 5173 |
| `apps/mobile` | Expo (React Native) + Expo Router | — |
| `packages/shared` | TypeScript types + enums compartidos | — |

### API
- **NestJS** con `@nestjs/jwt`, `@nestjs/event-emitter`, `class-validator`
- **Prisma ORM** con PostgreSQL (migraciones explícitas en `prisma/migrations/`)
- **SSE** (Server-Sent Events) para actualizaciones en tiempo real al dashboard
- **Push notifications** via Expo Push API (`PushService`)
- **Jest** + `ts-jest` para unit tests

### Web
- **React Query** (`@tanstack/react-query`) — toda la sincronización de estado de servidor
- **React Router v6** con `useSearchParams` para estado de navegación
- **Zustand** para auth store (`src/store/auth.ts`)
- **Tailwind CSS** — diseño, sin librería de componentes
- **react-hot-toast** para feedback de acciones

### Mobile
- **Expo Router** para navegación (file-based, similar a Next.js)
- **Zustand** para `useTaskStore` y `useAuthStore`
- **Expo Notifications** para recibir push tokens y mostrar alertas
- **SyncManager** (`src/syncManager.ts`) — cola offline para operaciones fallidas

### Shared (`packages/shared`)
- `src/enums.ts` — todos los enums (`CleaningStatus`, `HousekeepingRole`, etc.)
- `src/types.ts` — todas las interfaces DTO y tipos de SSE

---

## Architecture Decisions

### 1. Ciclo de dos fases (NO activar limpieza antes del checkout físico)
**Problema:** Si se crean tareas READY al planificar a las 7 am, housekeeping llega a limpiar camas OCUPADAS.
**Decisión:** Separación explícita:
- **Fase 1** (`batchCheckout`): Crea `CleaningTask(PENDING)`. El huésped AÚN está en la cama. Sin push. Sin `bed.status → DIRTY`.
- **Fase 2** (`confirmDeparture`): El huésped entrega la llave físicamente. ENTONCES: `PENDING → READY/UNASSIGNED`, `bed → DIRTY`, push a camarera.

### 2. Un checkout por habitación, tareas por cama
**Decisión:** Un `Checkout` corresponde a UNA habitación pero genera N `CleaningTask` (una por cama). En dormitorios compartidos, Cama 1 y Cama 2 comparten el mismo `checkoutId` pero tienen tareas independientes.
**Consecuencia crítica:** `confirmDeparture` debe recibir `bedId` para activar SOLO la cama específica. Sin `bedId`, activa todas las camas del checkout (útil para habitaciones privadas con 1 sola cama).

### 3. Servidor como fuente de verdad — no `useState` para estado confirmado
**Problema:** `useState(confirmed)` muere cuando el componente se desmonta (navegar a otra página y volver resetea el estado).
**Decisión:** `planningIsDone` se DERIVA del servidor:
```typescript
const planningIsDone =
  allBeds.some((b) => !!b.taskId && !b.cancelled) ||  // tareas en BD
  localStorage.getItem('planning-no-checkout-confirmed') === TODAY  // edge case: 0 salidas
```
El `localStorage` solo cubre el edge case de "confirmar planificación sin ninguna cama marcada".

### 4. URL search params para estado de tab (no useState)
**Problema:** `useState('planning')` muere al navegar. El usuario debería poder compartir el link de la pestaña activa.
**Decisión:**
```typescript
const [searchParams, setSearchParams] = useSearchParams()
const activeTab = (searchParams.get('tab') as 'planning' | 'realtime') ?? 'planning'
```
URL: `/planning?tab=realtime` — persiste entre navegaciones y recargas.

### 5. `await qc.refetchQueries()` vs `invalidateQueries()` — race condition crítica
**Problema:** `invalidateQueries()` retorna `void` inmediatamente (fire-and-forget). Si se hace `setActiveTab('realtime')` justo después, la pestaña abre con datos VIEJOS (sin `taskId`) → `planningIsDone = false` → "Sin planificación confirmada".
**Decisión:** Usar `await qc.refetchQueries(...)` que retorna una Promise que solo resuelve cuando los datos frescos llegan. ENTONCES cambiar de tab.

### 6. No Redux ni Zustand para estado de servidor
**Decisión:** React Query maneja TODO el estado de servidor. Zustand solo para auth (token JWT, user). No hay contexto compartido entre páginas para datos del servidor — cada página consulta directamente con React Query y aprovecha el cache.
**Razonamiento:** Redux/Zustand + servidor = sincronización manual = bugs. React Query es exactamente para esto.

### 7. `TaskLog.staffId` nullable
**Problema:** Eventos del sistema (cancelaciones automáticas, logs del sistema) no tienen staff asociado. Usar `staffId: 'system'` causaba FK violation en Postgres porque 'system' no existe en `HousekeepingStaff`.
**Decisión:** `staffId String?` en schema Prisma. Migration: `20260321141443_make_tasklog_staffid_nullable`.

### 8. `getDailyGrid` — fechas UTC explícitas (fix timezone)
**Problema:** `new Date('2026-03-21').setHours(0,0,0,0)` usa el timezone LOCAL del servidor. En UTC-5, esto produce `dayStart = 2026-03-20T05:00:00Z` (día anterior). Las tareas creadas a mediodía caen fuera del rango → `taskId: null` → `planningIsDone = false`.
**Decisión:**
```typescript
const dayStart = new Date(`${date}T00:00:00.000Z`)  // UTC explícito SIEMPRE
const dayEnd   = new Date(`${date}T23:59:59.999Z`)
```

### 9. Seed con delete en cascada seguro
**Problema:** `bed.deleteMany()` fallaba con FK violation porque `CleaningTask` referencia `Bed`.
**Decisión:** Orden de eliminación explícito:
```
TaskLog → CleaningNote → MaintenanceIssue → CleaningTask → BedDiscrepancy → Bed
```

### 10. Prioridad URGENT por habitación, no por cama
**Decisión:** Si CUALQUIER cama en una habitación tiene `hasSameDayCheckIn: true`, TODAS las tareas de esa habitación reciben prioridad `URGENT`. Justificación: la habitación completa necesita estar lista antes de las 3pm para el nuevo huésped.

---

## Project Structure

```
housekeeping3/
├── apps/
│   ├── api/                          NestJS REST API
│   │   ├── prisma/
│   │   │   ├── schema.prisma         Modelos Prisma (fuente de verdad del DB)
│   │   │   ├── seed.ts               Datos de prueba (1 propiedad, 3 rooms, 4 staff)
│   │   │   └── migrations/           Migraciones históricas (NO modificar manualmente)
│   │   └── src/
│   │       ├── auth/                 JWT auth (login, guard, estrategia)
│   │       ├── checkouts/            ★ Módulo central — ver sección Módulos
│   │       │   ├── checkouts.service.ts      Lógica de negocio (2 fases)
│   │       │   ├── checkouts.service.spec.ts 28 unit tests
│   │       │   ├── checkouts.controller.ts   5 endpoints
│   │       │   └── dto/                      BatchCheckoutDto, CreateCheckoutDto
│   │       ├── tasks/                Estado de tareas de housekeeping
│   │       │   ├── tasks.service.ts          start/end/pause/verify/assign
│   │       │   └── tasks.service.spec.ts     19 unit tests
│   │       ├── notifications/        SSE + Push
│   │       │   ├── notifications.service.ts  EventEmitter → SSE stream por propertyId
│   │       │   └── push.service.ts           Expo Push API
│   │       ├── discrepancies/        Reportes de discrepancias cama-estado
│   │       ├── staff/                CRUD de housekeepers/supervisores/recepcionistas
│   │       ├── rooms/                CRUD de habitaciones
│   │       ├── beds/                 CRUD de camas
│   │       ├── reports/              Métricas del día
│   │       ├── settings/             PropertySettings (timezone, checkout time)
│   │       ├── integrations/
│   │       │   └── cloudbeds/        Webhook handler (idempotente)
│   │       ├── common/
│   │       │   ├── decorators/       @CurrentUser, @Roles, @Public
│   │       │   ├── guards/           JwtAuthGuard, RolesGuard
│   │       │   └── filters/          HttpExceptionFilter (formato de errores uniforme)
│   │       └── prisma/               PrismaService (singleton global)
│   │
│   ├── web/                          React SPA (dashboard recepción + supervisores)
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── DailyPlanningPage.tsx  ★ Pantalla principal — ver sección Módulos
│   │       │   ├── KanbanPage.tsx         Vista supervisor (columnas por estado)
│   │       │   ├── CheckoutsPage.tsx      Historial de checkouts
│   │       │   ├── DiscrepanciesPage.tsx  Lista de discrepancias abiertas
│   │       │   ├── ReportsPage.tsx        Métricas del día
│   │       │   └── LoginPage.tsx
│   │       ├── components/
│   │       │   ├── Sidebar.tsx        Navegación desktop + mobile drawer
│   │       │   └── Navbar.tsx
│   │       ├── hooks/
│   │       │   └── useSSE.ts          EventSource con reconexión y cleanup automático
│   │       ├── api/
│   │       │   └── client.ts          Wrapper fetch con JWT, error handling, TypeScript
│   │       └── store/
│   │           └── auth.ts            Zustand — token JWT + datos del usuario
│   │
│   └── mobile/                       Expo app para housekeepers
│       ├── app/
│       │   ├── (auth)/login.tsx       Login con credenciales
│       │   └── (app)/
│       │       ├── rooms.tsx          Lista de tareas asignadas (pantalla principal)
│       │       └── task/[id].tsx      Detalle de tarea + notas + mantenimiento
│       └── src/
│           ├── store/
│           │   ├── auth.ts            Zustand — sesión persistida
│           │   └── tasks.ts           Zustand — lista de tareas con fetch
│           ├── syncManager.ts         Cola offline para ops fallidas
│           └── notifications.ts      Registro de push token con API
│
└── packages/
    └── shared/
        └── src/
            ├── enums.ts              Todos los enums del dominio
            └── types.ts              DTOs, DailyPlanningGrid, SseEvent, etc.
```

---

## Modules Implemented

### ✅ CheckoutsService — COMPLETO

**Responsabilidad:** Toda la lógica de checkout. Punto de entrada único para flujos manual y automático.

**Métodos:**

| Método | Endpoint | Estado | Descripción |
|--------|----------|--------|-------------|
| `batchCheckout` | `POST /checkouts/batch` | ✅ | Fase 1: planificación matutina. Crea tasks PENDING |
| `confirmDeparture` | `POST /checkouts/:id/depart` | ✅ | Fase 2: checkout físico. bedId-específico |
| `cancelCheckout` | `PATCH /checkouts/:id/cancel` | ✅ | Extensión de estadía. Alerta si hay IN_PROGRESS |
| `processCheckout` | `POST /checkouts` | ✅ | Checkout individual ad-hoc (idempotente) |
| `getDailyGrid` | `GET /planning/daily` | ✅ | Grid del día con tzUTC fix |
| `findByProperty` | `GET /checkouts` | ✅ | Historial de checkouts |

**Tests:** 28 unit tests en `checkouts.service.spec.ts` — 28/28 PASS.

**Casos edge cubiertos:**
- Idempotencia por `cloudbedsReservationId` (webhooks duplicados)
- `confirmDeparture` con y sin `bedId` (dorm vs privada)
- Idempotencia de `confirmDeparture` (→ `{ alreadyDeparted: true }`)
- `cancelCheckout` con tareas `IN_PROGRESS` → alerta supervisor, NO cancela automáticamente
- `cancelCheckout` también cancela tareas `PENDING` (extensión antes de Fase 2)

---

### ✅ DailyPlanningPage.tsx — COMPLETO

**Responsabilidad:** Pantalla de operaciones del recepcionista. Dos pestañas en una URL.

**Tab 1: "Planificación del Día"**
- Grid tipo pizarra. Cada celda = una cama.
- Click cicla: `EMPTY → CHECKOUT → CHECKOUT_URGENT → EMPTY`
- `EMPTY` = cama disponible hoy (no marcada para salida)
- `CHECKOUT` = salida programada (prioridad MEDIUM)
- `CHECKOUT_URGENT` = salida + entrada mismo día (prioridad URGENT)
- Botón "Confirmar Planificación" → `POST /checkouts/batch`
- Banner verde `✅ Planificación confirmada` cuando `planningIsDone = true`
- Todas las celdas se bloquean post-confirmación (`disabled`)

**Tab 2: "Estado en Tiempo Real"**
- Muestra el progreso de las salidas confirmadas
- Tab deshabilitada (gris) hasta que se confirme la planificación
- Única acción disponible: tocar una cama `PENDING_DEPARTURE` → modal → `POST /checkouts/:id/depart`
- Actualizado por SSE (`task:planned`, `task:ready`, etc.)

**Componentes internos (todos en el mismo archivo):**
- `PlanningTable` — tabla de rooms/camas con override local
- `PlanningRow` — fila de una habitación (dorm o privada)
- `RealtimeSection` — grid de tiempo real por habitación
- `RealtimeBedChip` — chip de cama con máquina de estados visual
- `DepartureModal` — confirmación de salida física (Fase 2)
- `DiscrepancyBanner` — alerta de discrepancias abiertas

**Lógica de estado clave:**
```typescript
// planningIsDone se deriva del servidor — NUNCA de useState
const planningIsDone =
  allBeds.some((b) => !!b.taskId && !b.cancelled) ||
  localStorage.getItem('planning-no-checkout-confirmed') === TODAY

// Tab via URL — persiste entre navegaciones
const activeTab = searchParams.get('tab') ?? 'planning'

// Cache config de React Query para el grid
staleTime: 2 * 60 * 1000   // 2 minutos — no re-fetches innecesarios
gcTime:   10 * 60 * 1000   // 10 minutos — cache vivo aunque el tab no esté activo
refetchInterval: 30 * 1000  // SSE es la fuente principal, polling es fallback
```

---

### ✅ TasksService — COMPLETO

**Responsabilidad:** Ciclo de vida de una `CleaningTask` una vez activada.

**Máquina de estados:**
```
UNASSIGNED → (assign) → READY → (start) → IN_PROGRESS → (end) → DONE → (verify) → VERIFIED
                                         ↘ (pause) → PAUSED → (resume) → IN_PROGRESS
```

**Tests:** 19 unit tests en `tasks.service.spec.ts` — 19/19 PASS.

---

### ✅ NotificationsService (SSE) — COMPLETO

**Responsabilidad:** Stream SSE por `propertyId`. El dashboard web se suscribe en `GET /api/events`.

**Eventos SSE implementados:**
| Evento | Cuándo se emite |
|--------|----------------|
| `task:planned` | Después de `batchCheckout` exitoso |
| `task:ready` | Después de `confirmDeparture` exitoso |
| `task:started` | Housekeeper inicia limpieza |
| `task:done` | Housekeeper termina limpieza |
| `task:unassigned` | Tarea queda sin asignar |
| `task:cancelled` | Checkout cancelado |
| `maintenance:reported` | Issue de mantenimiento reportado |
| `discrepancy:reported` | Discrepancia de cama reportada |

**Autenticación SSE:** Token JWT via query param (`/api/events?token=...`) porque `EventSource` no soporta headers custom.

---

### ✅ Mobile App — PARCIAL

**Lo que existe:**
- Login screen funcional
- `rooms.tsx` — lista de tareas asignadas al usuario logueado
- `task/[id].tsx` — detalle de tarea con botones start/pause/end
- `syncManager.ts` — cola offline (operaciones se guardan si no hay red)
- Push token registration

**Lo que falta:**
- UI para reportar discrepancias desde mobile
- UI para agregar notas de limpieza
- UI para reportar issues de mantenimiento con foto
- Offline mode completo (sync al reconectar)
- Tests

---

### 🔲 KanbanPage.tsx — ESQUELETO (prioridad alta)

Vista supervisor con columnas: `UNASSIGNED | READY | IN_PROGRESS | PAUSED | DONE | VERIFIED`.
Actualmente existe el archivo pero solo renderiza un placeholder.
**Crítico:** Sin esta pantalla, el supervisor no puede ver qué camareras están haciendo qué.

---

### 🔲 Asignación de tareas — NO IMPLEMENTADO

`assignTask` existe en `TasksService` pero no hay UI para asignar camareras a camas específicas.
Actualmente todas las tareas quedan `UNASSIGNED` porque no hay lógica de auto-asignación ni UI manual.

---

## Patterns & Conventions

### API (NestJS)
```typescript
// Decoradores siempre en este orden:
@Get(':id')
@Roles(HousekeepingRole.SUPERVISOR)
async findOne(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {}

// Servicios: toda la lógica de negocio aquí, controllers son thin wrappers
// DTOs: validados con class-validator en dto/ subdirectorio
// Errores: throw NotFoundException | ConflictException | ForbiddenException
// Logs: this.logger.debug/log/warn/error (Logger de NestJS, no console.log)
```

### Web (React)
```typescript
// Queries: siempre con queryKey tipado y opciones explícitas
const { data } = useQuery<DailyPlanningGrid>({
  queryKey: ['daily-grid', TODAY],
  queryFn: () => api.get(`/planning/daily?date=${TODAY}`),
  staleTime: 2 * 60 * 1000,
})

// Mutations: onSuccess async cuando hay refetch crítico
const mutation = useMutation({
  mutationFn: (dto) => api.post('/checkouts/batch', dto),
  onSuccess: async () => {
    await qc.refetchQueries({ queryKey: ['daily-grid', TODAY] })  // AWAIT — no invalidate
    setActiveTab('realtime')
  },
})

// Estado de navegación → URL params (no useState)
// Estado local efímero → useState (overrides de celdas antes de confirmar)
// Estado de servidor → React Query (NUNCA duplicar en useState)
// Auth → Zustand (token JWT)
```

### Shared Types
- Todos los enums están en `packages/shared/src/enums.ts`
- Todos los DTOs y tipos de respuesta en `packages/shared/src/types.ts`
- **NUNCA** redefinir un tipo en `apps/web` o `apps/api` si ya existe en shared
- `SseEventType` union — agregar aquí cuando se añade un nuevo evento SSE

### Tests
```typescript
// Patrón AAA con comentarios explícitos
it('descripción en español — qué debe hacer', async () => {
  // Arrange — setup del escenario
  // Act — llamada al método bajo test
  // Assert — verificación
})

// Builders de datos: makeRoom(), makeCheckout(), makeCheckoutInput()
// Mocks: prismaMock con $transaction que ejecuta callback directamente
// Limpiar mocks: jest.clearAllMocks() en beforeEach
```

---

## Module Relationships & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FLUJO DE DATOS PRINCIPAL                            │
│                                                                             │
│  Web (DailyPlanningPage)                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │ GET /planning/daily ──────────────────→ CheckoutsService         │        │
│  │                       getDailyGrid()    (rooms × beds × tasks)  │        │
│  │                                                                  │        │
│  │ POST /checkouts/batch ────────────────→ CheckoutsService         │        │
│  │                       batchCheckout()   crea Task(PENDING)/cama │        │
│  │                                         emite SSE task:planned  │        │
│  │                                                                  │        │
│  │ POST /checkouts/:id/depart ───────────→ CheckoutsService         │        │
│  │   { bedId }           confirmDeparture() activa Task(READY)      │        │
│  │                                         bed → DIRTY             │        │
│  │                                         push a camarera        │        │
│  │                                         emite SSE task:ready   │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                             │
│  SSE stream ──────────────────────────────→ useSSE() → invalidateQueries   │
│  (GET /events?token=...)                     actualiza DailyPlanningGrid    │
│                                                                             │
│  Mobile (RoomsScreen)                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │ GET /tasks ──────────────────────────→ TasksService.findMine()  │        │
│  │                                        filtra por assignedToId  │        │
│  │                                                                  │        │
│  │ POST /tasks/:id/start ────────────────→ TasksService.startTask()│        │
│  │ POST /tasks/:id/end ──────────────────→ TasksService.endTask()  │        │
│  │                                         emite SSE task:done    │        │
│  └─────────────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘

Relaciones Prisma clave:
  Property → Room[] → Bed[] → CleaningTask[] → TaskLog[]
  Checkout → CleaningTask[] (un checkout, N tareas)
  HousekeepingStaff → CleaningTask[] (assignedTo) | verifiedTasks | taskLogs
```

---

## Pending Tasks

Ordenadas por dependencia lógica/prioridad operativa:

### Alta prioridad (bloquean flujo operativo)

**1. KanbanPage — vista supervisor de tareas**
- Columnas: `UNASSIGNED → READY → IN_PROGRESS → PAUSED → DONE → VERIFIED`
- Cards arrastrables (o buttons) para cambiar estado
- Asignación de camarera desde el kanban (drag a staff, o select)
- Sin esto, el supervisor opera ciego

**2. Asignación de tareas a housekeepers**
- UI en KanbanPage: card con `<select>` de staff disponibles
- Backend: `PUT /tasks/:id/assign` ya existe en TasksService
- Sin esto, todas las tareas quedan `UNASSIGNED` indefinidamente

**3. Mobile — screens pendientes**
- `DiscrepancyReportScreen` — formulario tipo/descripción + foto opcional
- `NoteScreen` — agregar nota de limpieza a una tarea
- `MaintenanceIssueScreen` — reportar problema de mantenimiento

### Media prioridad

**4. DiscrepanciesPage web — flujo de resolución**
- La lista existe, falta el botón "Resolver discrepancia" con formulario
- `PATCH /discrepancies/:id/resolve` (endpoint existe, UI no)

**5. ReportsPage — métricas del día**
- El endpoint `GET /reports/overview` existe
- UI pendiente: gráficas de tareas completadas, tiempo promedio, performance por staff

**6. Websocket para actualizaciones mobile**
- La mobile usa polling (`fetchTasks()` al volver a foreground)
- Debería usar WebSocket o SSE para actualizaciones en tiempo real

### Baja prioridad

**7. Tests E2E con Supertest**
- No hay tests de integración (solo unit tests con mocks)
- Escenarios críticos a cubrir:
  - Flujo completo: batch → depart cama específica → verificar que otras camas no cambian
  - CloudBeds webhook idempotencia
  - Auth: acceso sin token, token expirado

**8. CI/CD pipeline**
- `.github/workflows/ci.yml` existe (básico)
- Falta: deploy automático a staging en merge a main

**9. PmsConfig / CloudBeds integración**
- `cloudbeds.service.ts` existe como esqueleto
- Falta: implementar el webhook handler real con verificación HMAC

---

## Known Issues & Edge Cases

### Resueltos en esta sesión (documentados para referencia)

| Issue | Causa | Fix |
|-------|-------|-----|
| `confirmDeparture` activaba todas las camas | checkout agrupa N camas; sin `bedId`, activa todas | Pasar `body.bedId` al endpoint; filtrar `t.bedId === bedId` en service |
| "Sin planificación confirmada" post-confirm | `invalidateQueries()` es void; tab cambia antes de datos frescos | `await qc.refetchQueries()` retorna Promise; esperar datos antes de tab-switch |
| `taskId: null` en zonas UTC-5 | `setHours(0,0,0,0)` usa local time | `new Date(\`\${date}T00:00:00.000Z\`)` UTC explícito |
| `TaskLog.staffId` FK violation | `staffId: 'system'` no existe en HousekeepingStaff | `staffId String?` nullable + `staffId: null` como fallback |
| Estado perdido al navegar | `useState(confirmed)` muere al desmontarse | `planningIsDone` derivado del servidor + URL params para tab |
| Seed cascade delete FK error | `bed.deleteMany()` bloqueado por FK de CleaningTask | Orden: TaskLog → CleaningNote → MaintenanceIssue → CleaningTask → BedDiscrepancy → Bed |

### Pendientes / Conocidos

**Edge case: planificación sin ninguna salida**
El recepcionista confirma aunque no haya marcado ninguna cama (día sin salidas).
`POST /checkouts/batch` con `items: []` no crea nada → `planningIsDone = false`.
Fix aplicado: `localStorage.setItem('planning-no-checkout-confirmed', TODAY)` se guarda en el frontend cuando `checkouts.length === 0`, y `planningIsDone` lo lee. Funciona pero depende de localStorage (no se sincroniza entre dispositivos).

**Mobile sin tests**
No hay ningún test en `apps/mobile`. La lógica de `syncManager.ts` es compleja y sin cobertura.

**`batchCheckout` no es idempotente**
Si el recepcionista confirma dos veces (doble clic), se crean dos juegos de tareas `PENDING`. El frontend previene con `isPending` en el mutation, pero no hay guard en el backend.

**PropertySettings.timezone no se usa en getDailyGrid**
La columna `PropertySettings.timezone` existe en el schema pero `getDailyGrid` usa UTC hardcodeado. Para propiedades fuera de UTC esto podría ser un problema si la API corre en un servidor remoto. Por ahora el workaround es suficiente (UTC es correcto si la BD y API están en el mismo servidor).

---

## Commands

### Setup inicial
```bash
# Instalar dependencias (desde la raíz del monorepo)
npm install

# Variables de entorno (copiar y editar)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Crear base de datos (PostgreSQL debe estar corriendo)
cd apps/api
npx prisma migrate dev
npx ts-node -r tsconfig-paths/register prisma/seed.ts
```

### Desarrollo
```bash
# API (NestJS) — desde apps/api/
npx ts-node -r tsconfig-paths/register src/main.ts
# O con hot-reload:
npx nest start --watch

# Web (Vite) — desde apps/web/
npx vite

# Mobile — desde apps/mobile/
npx expo start
```

### Tests
```bash
# Todos los tests (desde apps/api/)
cd apps/api && npx jest

# Un suite específico con verbose
npx jest --testPathPattern="checkouts.service.spec" --verbose

# TypeScript check (sin compilar)
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit

# Build de producción web
cd apps/web && npx vite build
```

### Base de datos
```bash
# Resetear a datos limpios (útil al probar manualmente)
cd apps/api && npx ts-node -r tsconfig-paths/register prisma/seed.ts

# Nueva migración
npx prisma migrate dev --name nombre_de_la_migracion

# Abrir Prisma Studio (explorador visual de la BD)
npx prisma studio
```

### Credenciales de seed
| Email | Password | Rol |
|-------|----------|-----|
| `reception@demo.com` | `reception123` | RECEPTIONIST |
| `supervisor@demo.com` | `supervisor123` | SUPERVISOR |
| `hk1@demo.com` | `hk123` | HOUSEKEEPER |
| `hk2@demo.com` | `hk123` | HOUSEKEEPER |

### Endpoints clave para pruebas manuales
```bash
BASE="http://localhost:3000/api"
TOKEN="..." # Obtener con POST /api/auth/login

# Grid del día
curl -H "Authorization: Bearer $TOKEN" "$BASE/planning/daily?date=2026-03-21"

# Planificar salidas (obtener bedIds del grid primero)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"items":[{"bedId":"BED_ID","hasSameDayCheckIn":false}],"checkoutDate":"2026-03-21"}' \
  "$BASE/checkouts/batch"

# Confirmar salida física (bedId específico)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"bedId":"BED_ID"}' \
  "$BASE/checkouts/CHECKOUT_ID/depart"

# Cancelar checkout (huésped extiende)
curl -X PATCH -H "Authorization: Bearer $TOKEN" "$BASE/checkouts/CHECKOUT_ID/cancel"
```

---

## Non-Negotiable Decisions

> Las siguientes decisiones fueron tomadas deliberadamente y NO deben revertirse sin discusión:

1. **Dos fases de checkout** — `batchCheckout` crea PENDING (sin notificar); `confirmDeparture` activa (notifica). Jamás activar limpieza antes de confirmación física.

2. **`confirmDeparture` debe recibir `bedId`** — sin él, en dorms se activan todas las camas del checkout. El frontend SIEMPRE debe enviar el bedId de la cama específica.

3. **`await qc.refetchQueries()`** (no `invalidateQueries`) antes de cualquier navegación que dependa de datos frescos.

4. **Fechas UTC explícitas en queries de Prisma** — nunca `setHours(0,0,0,0)` que usa local time.

5. **`planningIsDone` derivado del servidor** — nunca de `useState`. El source of truth es `allBeds.some(b => !!b.taskId && !b.cancelled)`.

6. **Tab state en URL params** — `useSearchParams`, nunca `useState` para tabs que el usuario navega.
