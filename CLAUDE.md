# CLAUDE.md — Zenix PMS

> Guía para retomar el proyecto desde cero. Lee esto antes de tocar código.
> Última actualización: 2026-04-25 (Sprint 7B ✅ + 7C ✅ + 7D ✅ + 8 ✅ + 8E ✅ + 8F ✅ completos; Sprint 8F — Ventana temporal de no-show con día hotelero real: `potentialNoShowWarningHour` + `noShowCutoffHour`; botón "Revertir no-show" en tooltip; guard backend anti-precipitación; Channex gateway integrado; Cloudbeds eliminado).

---

## Principio Rector de Diseño — Obligatorio en Todo Código

> **Este principio aplica a CADA decisión de UI, flujo, arquitectura de información, y experiencia de usuario. No es opcional.**

Todo código, componente, flujo o pantalla que se escriba en Zenix debe estar cimentado en:

**Estándares globales con base psicológica, comportamiento humano y neuromarketing**, con la finalidad de crear sistemas precisos, entendibles, transparentes, claros y fluidos.

### Marco de referencia obligatorio

**Psicología cognitiva y comportamiento humano:**
- **Carga cognitiva (Sweller, 1988)** — minimizar la información simultánea en pantalla. El cerebro humano procesa 7±2 elementos en memoria de trabajo (Miller, 1956). Todo panel, modal o vista debe respetar este límite.
- **Ley de Hick (1952)** — el tiempo de decisión aumenta logarítmicamente con el número de opciones. Reducir opciones visibles = reducir tiempo de reacción del operador.
- **Ley de Fitts (1954)** — el tiempo para alcanzar un objetivo depende de su tamaño y distancia. Botones de acción frecuente deben ser grandes y cercanos al foco natural de atención.
- **Efecto de posición serial (Ebbinghaus)** — los usuarios recuerdan mejor lo primero y lo último. La información más crítica va al inicio o al final, nunca al centro de una lista larga.
- **Modelo de procesamiento dual (Kahneman, 2011)** — el Sistema 1 (rápido, automático) toma la mayoría de decisiones operativas. El diseño debe soportar operación por Sistema 1 en flujos rutinarios, y activar Sistema 2 (lento, deliberado) solo en decisiones de alto impacto (confirmaciones destructivas).

**Estándares de usabilidad global:**
- **Nielsen Norman Group — 10 Heurísticas de Usabilidad (1994, rev. 2020)** — visibilidad del estado del sistema, control del usuario, prevención de errores, reconocimiento sobre recuerdo.
- **Apple Human Interface Guidelines (2024)** — feedback inmediato, acciones destructivas con confirmación, diseño para la 100ª sesión no la 1ª.
- **ISO 9241-110:2020** — autodescripción, controlabilidad, conformidad con expectativas del usuario, tolerancia a errores.
- **WCAG 2.1 AA** — contraste mínimo 4.5:1 para texto normal, 3:1 para UI components. `motion-reduce` en todas las animaciones.

**Neuromarketing y percepción:**
- **Psicología del color (Mehrabian-Russell, 1974; Cialdini, 1984)** — colores con semántica precisa: `emerald` = disponibilidad/acción positiva ("go"), `amber` = advertencia no-bloqueante (advisory), `red` = rechazo/escasez/urgencia. El recepcionista debe poder tomar decisiones solo por color, sin leer texto.
- **Principio de proximidad (Gestalt)** — elementos relacionados visualmente cercanos. Acciones de una reserva agrupadas, no dispersas en la pantalla.
- **Efecto de encuadre (Tversky & Kahneman, 1981)** — cómo se presenta la información determina la decisión. Un precio delta "€12 adicionales" se percibe diferente a "€12 de cargo extra". Los modales de confirmación usan lenguaje positivo-neutro, nunca alarmista innecesario.
- **Flujo (Csikszentmihalyi, 1990)** — el operador en estado de flujo comete menos errores. Interfaces fluidas, predecibles y sin interrupciones innecesarias mantienen al usuario en estado de flujo.
- **Principio de escasez visual** — los badges de urgencia (`🔴 Hoy entra`, `🔒 En uso`) usan rojo/amber porque el cerebro humano responde con atención prioritaria a estas señales de advertencia (evolución: señales de peligro = rojo/naranja).

### Cómo aplicar este principio al escribir código

Antes de implementar cualquier componente UI, responder:
1. **¿Cuántos elementos simultáneos ve el usuario?** → Si son más de 5, agrupar o colapsar.
2. **¿El color comunica el estado correctamente?** → Usar el sistema de color semántico de Zenix (emerald/amber/red), nunca colores arbitrarios.
3. **¿El flujo requiere Sistema 1 o Sistema 2?** → Flujo rutinario = mínima fricción. Acción destructiva = confirmación explícita (forcing function).
4. **¿El feedback es inmediato?** → Toda acción debe tener respuesta visual en ≤100ms (loading state, cambio de color, toast).
5. **¿La animación tiene propósito?** → Usar `--ease-spring` (entrada) y `--ease-sharp-out` (salida). Nunca animar solo por estética.
6. **¿El error es informativo?** → Nunca "Error genérico". Siempre: qué pasó + por qué + qué puede hacer el usuario.

---

## Project Overview

**Zenix es un PMS (Property Management System)** para hoteles boutique y hostales de LATAM con dormitorios compartidos y habitaciones privadas. El eje central del sistema es el **calendario de reservas**, que actúa como fuente de verdad de todos los datos de huéspedes, ocupación y operación.

Del calendario se derivan todos los módulos del sistema:
- **Housekeeping** — el calendario sabe qué habitaciones tienen checkout hoy y activa las tareas de limpieza correspondientes
- **No-shows** — el calendario sabe qué huéspedes no llegaron y dispara el flujo fiscal de no-show
- **Reportes** — el calendario es la fuente de verdad de ocupación, revenue y métricas operativas
- **Mantenimiento** — el calendario sabe qué habitaciones están bloqueadas y por qué
- **Disponibilidad** — toda verificación de inventario consulta el estado del calendario antes de confirmar cualquier reserva

> **Nota histórica:** el proyecto comenzó explorando el módulo de housekeeping como prueba de concepto. Desde Sprint 6 el sistema es un PMS completo. El repositorio conserva el nombre `housekeeping3` por continuidad técnica, pero el producto es Zenix PMS.

**Ventajas competitivas vs PMS del mercado (Mews, Opera Cloud, Cloudbeds, Clock PMS+):**
- **Calendario PMS con SSE en tiempo real** — al nivel de los PMS premium. El estado de cada habitación se actualiza en pantalla sin recargar.
- **Gestión per-bed nativa** — tarea por cama, no por habitación. Solo Mews lo ofrece parcialmente. Construido desde el primer día para la realidad de los hostales.
- **Checkout de 2 fases** — planificación AM + confirmación física. Ningún competidor lo tiene. Elimina el problema de housekeepers que limpian habitaciones con huéspedes adentro.
- **App móvil offline con cola de sync** — ningún PMS entry-level soporta operación offline. Crítico para pisos sin señal wifi consistente.
- **Auditoría fiscal-grade de no-shows** — trail inmutable, ventana de reversión de 48h, cargos traceables. Opera/Cloudbeds no tienen revert auditado; Mews tiene revert pero sin cumplimiento fiscal LATAM.
- **Pre-arrival warming con WhatsApp automático** — detección temprana de no-shows a las 20:00 local con outreach automático. Ningún PMS del mercado lo tiene.
- **Night audit multi-timezone** — scheduler per-propiedad usando IANA timezone. Un cliente con hoteles en México, Colombia y España recibe el corte en la hora local correcta de cada propiedad. Ningún PMS entry-level resuelve esto.

---

## Flujo Operativo Central (Etapa 1 — COMPLETO)

### Diagrama de secuencia completo

```
07:00  FASE 1 — Planificación matutina
       ┌──────────────────────────────────────────────────────────────────────┐
       │ Recepcionista abre DailyPlanningPage (tab "Planificación del Día")  │
       │ → GET /planning/daily?date=2026-03-22                               │
       │ → Servidor: room.findMany() con cleaningTasks filtradas por         │
       │   checkout.actualCheckoutAt (NO createdAt — inmune a timezone)      │
       │ → Respuesta: DailyPlanningGrid { sharedRooms[], privateRooms[] }    │
       │                                                                      │
       │ Click en celda → cycleState(): EMPTY → CHECKOUT → EMPTY             │
       │   Guard: cell.taskId && !cell.cancelled → bloquea si tarea activa   │
       │   Guard: planningIsDone → bloquea post-confirmación                 │
       │   Override se guarda en useState<Map<CellKey, Override>>            │
       │                                                                      │
       │ Botón "Confirmar Planificación"                                      │
       │ → POST /checkouts/batch { items: [{ bedId, hasSameDayCheckIn }] }   │
       │ → Servidor (por cada room agrupado):                                │
       │     1. tx.checkout.create({ roomId, actualCheckoutAt })             │
       │     2. tx.cleaningTask.create({ bedId, status: PENDING,             │
       │        hasSameDayCheckIn: per-bed (NO room-level) })                │
       │     3. tx.taskLog.create({ event: CREATED })                        │
       │     4. bed.status NO cambia (huésped aún está)                      │
       │ → SSE: task:planned { checkoutId, roomId }                          │
       │ → Frontend: await refetchQueries() → setActiveTab('realtime')       │
       └──────────────────────────────────────────────────────────────────────┘

11:00  FASE 2 — Confirmación de salida física
       ┌──────────────────────────────────────────────────────────────────────┐
       │ Recepcionista en tab "Estado en Tiempo Real"                        │
       │ → Cama muestra chip "Pendiente de salida" con acción               │
       │   "Toca cuando salga →"                                             │
       │ → Click abre DepartureModal → confirma                             │
       │                                                                      │
       │ → POST /checkouts/:id/depart { bedId }                              │
       │ → Servidor:                                                          │
       │     1. Filtra tarea PENDING para ese bedId específico                │
       │     2. tx.cleaningTask.update({ status: READY/UNASSIGNED })         │
       │     3. tx.bed.update({ status: DIRTY })                             │
       │     4. tx.taskLog.create({ event: READY })                          │
       │     5. pushService.send() → Expo Push a camarera asignada           │
       │ → SSE: task:ready { taskId, bedId }                                 │
       │ → Frontend: chip cambia a "Lista para limpiar"                      │
       └──────────────────────────────────────────────────────────────────────┘

11:30  FASE 2.5 — Reversión de salida (error recovery)
       ┌──────────────────────────────────────────────────────────────────────┐
       │ Si el recepcionista confirmó por error (huésped aún no salió):      │
       │ → Chip "Lista para limpiar" muestra "↩ Revertir salida"            │
       │ → Click abre UndoModal (amber) → confirma                          │
       │                                                                      │
       │ → POST /checkouts/:id/undo-depart { bedId }                         │
       │ → Servidor:                                                          │
       │     1. Busca tareas READY/UNASSIGNED del checkout (filtro bedId)     │
       │     2. Solo reversible si NO hay tareas IN_PROGRESS                  │
       │     3. tx.cleaningTask.update({ status: PENDING })                  │
       │     4. tx.bed.update({ status: OCCUPIED })                          │
       │     5. tx.taskLog.create({ event: REOPENED })                       │
       │     6. Push: "↩️ Salida revertida" al housekeeper asignado          │
       │ → SSE: task:planned { checkoutId }                                  │
       │ → Frontend: chip vuelve a "Pendiente de salida"                     │
       └──────────────────────────────────────────────────────────────────────┘

       CANCELACIÓN — Per-bed desde Tiempo Real
       ┌──────────────────────────────────────────────────────────────────────┐
       │ Chip "Pendiente de salida" muestra "Cancelar checkout"              │
       │ → Click abre CancelModal (gris/rojo) → confirma                    │
       │                                                                      │
       │ → PATCH /checkouts/:id/cancel { bedId }                              │
       │ → Servidor:                                                          │
       │     Con bedId: cancela SOLO la tarea de esa cama                     │
       │       → task.status = CANCELLED, bed.status = OCCUPIED              │
       │       → checkout.cancelled NO se marca (otras camas siguen)          │
       │     Sin bedId: cancela TODAS las tareas del checkout                 │
       │       → checkout.cancelled = true                                   │
       │     Tareas IN_PROGRESS: NO cancela, alerta al supervisor            │
       │ → SSE: task:cancelled { checkoutId }                                │
       └──────────────────────────────────────────────────────────────────────┘

12:00  FASE 3 — Ciclo de limpieza (mobile)
       ┌──────────────────────────────────────────────────────────────────────┐
       │ Camarera recibe push → abre app mobile                              │
       │ → GET /tasks?assignedToId=me → lista de tareas READY               │
       │                                                                      │
       │ → POST /tasks/:id/start → IN_PROGRESS, SSE: task:started           │
       │ → POST /tasks/:id/pause → PAUSED (puede pausar para otra tarea)    │
       │ → POST /tasks/:id/resume → IN_PROGRESS                             │
       │ → POST /tasks/:id/end → DONE, SSE: task:done                       │
       │                                                                      │
       │ Supervisor en KanbanPage (web):                                      │
       │ → POST /tasks/:id/verify → VERIFIED, SSE: task:verified            │
       └──────────────────────────────────────────────────────────────────────┘
```

### Máquina de estados de CleaningTask

```
                           ┌─────────────────────────────────────────┐
                           │           CANCELLED                      │
                           │  (cancelCheckout / undoDeparture fail)   │
                           └─────────────────────────────────────────┘
                                    ▲           ▲
                                    │           │
PENDING ──(confirmDeparture)──→ UNASSIGNED ──(assign)──→ READY
   │                               │                       │
   │ (undoDeparture) ◄─────────────┘                       │
   │ (undoDeparture) ◄─────────────────────────────────────┘
   │
   └──(cancelCheckout)──→ CANCELLED

READY ──(start)──→ IN_PROGRESS ──(end)──→ DONE ──(verify)──→ VERIFIED
                        │      ▲
                        └──────┘
                     (pause)  (resume)
                      PAUSED
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
- **Fase 2.5** (`undoDeparture`): Error recovery. Revierte `READY/UNASSIGNED → PENDING`, `bed → OCCUPIED`. Solo si no hay tareas IN_PROGRESS.

### 2. Un checkout por habitación, tareas por cama
**Decisión:** Un `Checkout` corresponde a UNA habitación pero genera N `CleaningTask` (una por cama). En dormitorios compartidos, Cama 1 y Cama 2 comparten el mismo `checkoutId` pero tienen tareas independientes.
**Consecuencia crítica:** `confirmDeparture` debe recibir `bedId` para activar SOLO la cama específica. Sin `bedId`, activa todas las camas del checkout (útil para habitaciones privadas con 1 sola cama).

### 3. `hasSameDayCheckIn` per-task (NO per-checkout)
**Problema:** `hasSameDayCheckIn` almacenado a nivel `Checkout` (room-level OR) causaba que TODAS las camas del dorm mostraran badge "🔴 Hoy entra" cuando solo una fue marcada.
**Decisión:** Campo `hasSameDayCheckIn Boolean @default(false)` en `CleaningTask`. `batchCheckout` lo guarda por cama individual: `hasSameDayCheckIn: itemMap.get(bed.id)?.hasSameDayCheckIn ?? false`. `getDailyGrid` lee `task?.hasSameDayCheckIn` (no `task?.checkout?.hasSameDayCheckIn`).
**Migración:** `20260322202309_add_has_same_day_check_in_to_task`.

### 4. Servidor como fuente de verdad — no `useState` para estado confirmado
**Problema:** `useState(confirmed)` muere cuando el componente se desmonta (navegar a otra página y volver resetea el estado).
**Decisión:** `planningIsDone` se DERIVA del servidor:
```typescript
const planningIsDone =
  allBeds.some((b) => !!b.taskId && !b.cancelled) ||  // tareas en BD
  localStorage.getItem('planning-no-checkout-confirmed') === TODAY  // edge case: 0 salidas
```

### 5. `getState()` — precedencia override vs servidor
**Problema:** Después de cancelar todas las tareas desde Realtime, el `overrides` Map mantenía estados `CHECKOUT` de la sesión anterior → las celdas aparecían como "Checkout hoy" en vez de "Disponible" al volver a la pestaña de planificación.
**Decisión:** Regla de precedencia en `getState()`:
```typescript
function getState(roomId, bedId, cell): PlanningCellState {
  // Tarea activa en servidor → servidor manda (ignorar overrides stale)
  if (cell.taskId && !cell.cancelled) return inferState(cell)
  // Sin tarea activa → override local (planificación en curso) o inferir de server
  return overrides.get(cellKey(roomId, bedId))?.state ?? inferState(cell)
}
```
**Guards de edición:** `cycleState()` y `toggleUrgente()` usan `cell.taskId && !cell.cancelled` (no solo `cell.taskId`), permitiendo re-planificar camas con tareas canceladas.

### 6. URL search params para estado de tab (no useState)
**Decisión:**
```typescript
const activeTab = (searchParams.get('tab') as 'planning' | 'realtime') ?? 'planning'
```
URL: `/planning?tab=realtime` — persiste entre navegaciones y recargas.

### 7. `await qc.refetchQueries()` vs `invalidateQueries()` — race condition crítica
**Problema:** `invalidateQueries()` retorna `void` inmediatamente (fire-and-forget). Si se hace `setActiveTab('realtime')` justo después, la pestaña abre con datos VIEJOS.
**Decisión:** Usar `await qc.refetchQueries(...)` que retorna una Promise que solo resuelve cuando los datos frescos llegan. ENTONCES cambiar de tab.

### 8. `getDailyGrid` — filtro por `checkout.actualCheckoutAt` (NO `createdAt`)
**Problema:** `createdAt` usa `new Date()` del servidor. En timezones negativos (UTC-5), después de las 7pm local, `createdAt` ya cae en el día siguiente UTC → las tareas recién creadas no aparecen en el grid.
**Decisión:**
```typescript
// ANTES (roto en UTC-5 después de 7pm):
cleaningTasks: { where: { createdAt: { gte: dayStart, lte: dayEnd } } }

// AHORA (inmune a timezone — usa la fecha lógica del checkout):
cleaningTasks: { where: { checkout: { actualCheckoutAt: { gte: dayStart, lte: dayEnd } } } }
```
Las fechas del rango siguen siendo UTC explícitas:
```typescript
const dayStart = new Date(`${date}T00:00:00.000Z`)
const dayEnd   = new Date(`${date}T23:59:59.999Z`)
```

### 9. No Redux ni Zustand para estado de servidor
**Decisión:** React Query maneja TODO el estado de servidor. Zustand solo para auth (token JWT, user).

### 10. `TaskLog.staffId` nullable
**Problema:** Eventos del sistema (cancelaciones automáticas, REOPENED) no tienen staff asociado.
**Decisión:** `staffId String?` en schema Prisma.

### 11. Prioridad URGENT per-bed, propagada por habitación
**Decisión:** Si CUALQUIER cama en una habitación tiene `hasSameDayCheckIn: true`, TODAS las tareas de esa habitación reciben prioridad `URGENT` (la habitación completa necesita estar lista). Pero el badge visual "🔴 Hoy entra" solo aparece en la cama específica marcada (gracias a `hasSameDayCheckIn` per-task).

### 12. Cancelación per-bed vs per-checkout
**Decisión:** `cancelCheckout(checkoutId, bedId?)`:
- **Con `bedId`**: Cancela solo la tarea de esa cama. `checkout.cancelled` NO se marca (el checkout sigue para las demás camas del dorm).
- **Sin `bedId`**: Cancela todas las tareas. `checkout.cancelled = true`.
- **Tareas IN_PROGRESS**: NO se cancelan automáticamente. Se emite alerta al supervisor.

### 13. UX — texto mínimo, optimizar para uso diario
**Decisión (basada en NNGroup, Tufte, Krug, Apple HIG):** La interfaz se optimiza para la 100ª sesión, no la 1ª. Sin leyendas permanentes, sin hints persistentes, sin banners instructivos. Los chips de cama son auto-explicativos por color y acción inline. El banner post-confirmación es de 1 línea.

### 13b. Animaciones — fluidez nivel SwiftUI/iOS en todo el sistema
**Decisión:** Todas las animaciones del sistema (sheets, drawers, modales, toasts, transiciones de página) deben sentirse al nivel de SwiftUI/iOS: fluidas, naturales, sin rebote visible.

**Curvas canónicas** (definidas como CSS vars en `apps/web/src/index.css`):
```css
--ease-spring:    cubic-bezier(0.22, 1, 0.36, 1);   /* expo-out: entrada rápida, desacelera suave */
--ease-sharp-out: cubic-bezier(0.55, 0, 1, 0.45);   /* expo-in:  salida limpia y rápida */
```

**Reglas de aplicación:**
- **Entrada de paneles/sheets/modales**: 360–400ms con `--ease-spring`. Arranca con velocidad inicial alta y desacelera suavemente — el usuario percibe respuesta inmediata.
- **Salida**: 200–220ms con `--ease-sharp-out`. Más corta (~40%) que la entrada; se "va" sin distraer.
- **Sin overshoot/rebote**: `y1 > 1.0` en `cubic-bezier` causa overshoot visible en panels — NUNCA usar curvas como `cubic-bezier(0.34, 1.56, 0.64, 1)` para elementos que se deslizan desde un borde.
- **`motion-reduce:duration-0`** en todos los elementos animados — accesibilidad para usuarios con epilepsia/vértigo.
- **La animación no debe llamar la atención**: si el usuario "nota" la animación, es demasiado lenta, lenta, o exagerada. El objetivo es que se sienta natural, no que impresione.
- **Radix UI**: usar `data-[state=open]:` y `data-[state=closed]:` — Radix setea `data-state`, NO `data-open`. El shorthand `data-open:` de Tailwind apunta a un atributo distinto y nunca dispara.

### 14. Night audit multi-timezone — `Intl.DateTimeFormat` por propiedad
**Problema:** Un PMS distribuido puede tener propiedades en múltiples países/regiones. Hardcodear `America/Mexico_City` en el cron job rompe el corte nocturno para propiedades en España, Colombia, Perú, etc.
**Decisión:** El scheduler `NightAuditScheduler` corre cada 30 minutos (`@Cron('0,30 * * * *')`). Por cada propiedad, evalúa la hora local usando su timezone configurado en `PropertySettings.timezone`. Usa exclusivamente `Intl.DateTimeFormat` (Node.js nativo, sin deps externas):
```typescript
function toLocalDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date)
}
function toLocalHour(date: Date, timezone: string): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', hour12: false
  }).format(date)
  return Number(h) % 24  // normaliza "24" → 0 (medianoche)
}
```
**Archivo:** `apps/api/src/pms/guest-stays/night-audit.scheduler.ts`
**NUNCA** usar `new Date().toLocaleDateString()` sin timezone explícito. Siempre pasar el timezone de la propiedad.

### 15. Idempotencia del night audit — `noShowProcessedDate`
**Problema:** El cron corre cada 30 min. Sin guardia, procesaría no-shows múltiples veces en el mismo día local.
**Decisión:** `PropertySettings.noShowProcessedDate DateTime? @db.Date` actúa como semáforo. El scheduler solo procesa si `localDate !== noShowProcessedDate`. Después de procesar, actualiza `noShowProcessedDate = localDate`. Si el servidor se reinicia o el cron dispara en minutos consecutivos, la segunda ejecución es no-op.

### 16. Ventana de reversión de no-show — 48 horas
**Problema:** Los errores operacionales ocurren: un recepcionista marca no-show por error o el huésped llega tarde. Se necesita recovery sin comprometer el audit trail.
**Decisión:** Ventana de 48h desde `noShowAt` para revertir. Después de 48h el registro es inmutable desde el sistema (solo admin-level puede modificar via BD). Este patrón sigue el estándar ISAHC y es consistente con Mews y Clock PMS+.
**Guard en código:**
```typescript
const hoursElapsed = differenceInHours(new Date(), stay.noShowAt)
if (hoursElapsed > 48) throw new ForbiddenException('Ventana de reversión expirada (48h)')
```
La reversión restaura `noShowAt: null`, `noShowChargeStatus: null`, libera el cuarto a `OCCUPIED`.

### 17. Liberación de inventario en no-show
**Problema:** `checkAvailability` filtraba `actualCheckout: null` para detectar ocupación. Un no-show sin `actualCheckout` seguía bloqueando el inventario — la habitación aparecía como ocupada aunque el huésped nunca llegó.
**Decisión:** Agregar `noShowAt: null` como condición adicional en la query de disponibilidad:
```typescript
where: {
  roomId,
  actualCheckout: null,
  noShowAt: null,       // ← crítico: excluir no-shows del inventario
  checkIn: { lt: to },
  checkOut: { gt: from },
}
```
**Consecuencia:** Un no-show libera la habitación instantáneamente para nueva venta.

### 18. `NoShowChargeStatus` — ciclo de vida fiscal
**Decisión:** Enum explícito para el estado del cargo, separado del estado del no-show mismo:
```
NOT_APPLICABLE → PENDING → CHARGED | FAILED | WAIVED
```
- `NOT_APPLICABLE`: la propiedad tiene `noShowFeePolicy: 'NONE'` o el actor explícitamente marcó `waiveCharge: true`
- `PENDING`: cargo capturado en el sistema, pendiente de procesamiento en pasarela de pago
- `CHARGED`: cargo exitoso — `noShowFeeAmount` y `noShowFeeCurrency` son la evidencia fiscal
- `FAILED`: intento de cargo fallido (sin fondos, tarjeta expirada, etc.)
- `WAIVED`: perdonado post-hecho por supervisor/manager
Esto permite reportes fiscales precisos: `SUM(noShowFeeAmount) WHERE chargeStatus = CHARGED`.

### 19. Reports multi-tab con lazy loading
**Problema:** ReportsPage antes cargaba todos los datos al abrir. Con el tab de no-shows (query costosa sobre GuestStay con rangos de fecha), la página inicial se volvería lenta.
**Decisión:** El tab activo se controla por URL param (`?tab=housekeeping` o `?tab=noshow`). Cada query tiene `enabled: activeTab === 'housekeeping'` / `enabled: activeTab === 'noshow'`. Los datos del tab inactivo no se cargan hasta que el usuario navega al tab. Patrón consistente con DailyPlanningPage.

### 20. No-show inline confirm — no Dialog separado
**Problema:** Abrir un modal extra para confirmar no-show interrumpe el flujo del recepcionista que ya está dentro del BookingDetailSheet.
**Decisión:** El panel de confirmación de no-show se despliega inline dentro del BookingDetailSheet (accordion-style con `showNoShowConfirm` estado local). Incluye: campo de razón, checkbox de waiveCharge, botones Cancelar/Confirmar. Patrón consistente con DepartureModal/CancelModal del DailyPlanningPage (confirmación en 2 pasos sin escalar el árbol de modales).

---

## Audit Trail como Diferenciador Competitivo

> Por qué el sistema de auditoría de Zenix supera a los PMS del mercado.

### El problema de la industria
Los PMS legacy (Opera, Cloudbeds, Clock PMS+) tienen auditoría incompleta en operaciones críticas:
- **Cloudbeds:** No-show es un cambio de estado sin timestamp ni actor. El reporte de no-shows es un filtro de reservas, no un log de eventos.
- **Opera Cloud:** El audit trail existe pero no es exportable en formato que cumpla CFDI México o facturas LATAM. Reportes fiscales requieren integración con ERP externo.
- **Clock PMS+:** Tiene reversión de no-show pero no registra quién lo revirtió ni la razón. El cargo de no-show no se vincula al journal de ingresos.
- **Mews:** El mejor de los comparados — tiene audit trail con actor y timestamp. Pero no tiene `waiveCharge` con razón auditada ni cumplimiento CFDI nativo.

### Lo que ofrece Zenix
Cada evento crítico genera un registro inmutable con actor, timestamp UTC, y razón:

| Operación | Campos auditados |
|-----------|-----------------|
| `markAsNoShow` | `noShowAt`, `noShowById`, `noShowReason`, `noShowChargeStatus`, `noShowFeeAmount` |
| `revertNoShow` | `noShowRevertedAt`, `noShowRevertedById`, `noShowAt → null` |
| `markAsNoShowSystem` | `noShowById: null` (indica actor sistema), `noShowAt` |
| Cargo fallido | `noShowChargeStatus: FAILED` + log en `StayJourney` |
| Cargo perdonado | `noShowChargeStatus: WAIVED`, actor y razón en `StayJourney.events` |

### Cumplimiento fiscal
- **México (CFDI 4.0):** Los ingresos por no-show deben facturarse. `noShowFeeAmount` + `noShowFeeCurrency` son los montos de la factura. El campo `noShowChargeStatus: CHARGED` confirma la recepción del ingreso.
- **Colombia/Perú/Argentina:** Similar. La nota de crédito por reversión usa `noShowRevertedAt` como fecha del evento.
- **España/UE:** GDPR: los datos del huésped en el no-show record (nombre, email) se pueden anonimizar sin perder el registro fiscal (montos y timestamps permanecen).
- **Regla de oro:** `GuestStay` con `noShowAt != null` NUNCA se borra con hard delete. Solo soft-delete o anonimización de PII. El registro del cargo permanece indefinidamente.

### El reporte `/reports/no-shows`
- Exportable a CSV para entrega al contador
- Agrupa por fuente (OTA, directo, etc.) para comisiones y disputas
- Suma `noShowFeeAmount` solo para `chargeStatus = CHARGED` (ingresos reales)
- Muestra `WAIVED` separado (perdonados — no ingresos pero sí eventos auditados)
- Filtro por rango de fechas — la pestaña `?tab=noshow` en ReportsPage

---

## Requisitos Fiscales (No Negociables)

> Estos requisitos tienen precedencia sobre cualquier decisión de producto o velocidad de desarrollo.

### 1. Inmutabilidad de registros de ingreso
Los siguientes registros NUNCA se eliminan con hard delete:
- `GuestStay` con `noShowAt != null` (cargo potencial de no-show)
- `GuestStay` con `paymentStatus: PAID | PARTIAL` (ingreso recibido)
- `StayJourney` y `StayJourneyEvent` asociados a los anteriores

Si un huésped solicita borrado de datos (GDPR/LGPD), se **anonimiza PII** (nombre, email, teléfono, documento → valores genéricos) pero el registro financiero y los timestamps permanecen.

### 2. Trazabilidad de cargos
Todo cargo de no-show debe tener:
- `noShowFeeAmount: Decimal` — monto exacto (no float, usar `Decimal` de `@prisma/client/runtime/library`)
- `noShowFeeCurrency: string` — ISO 4217 (e.g., `MXN`, `COP`, `USD`)
- `noShowChargeStatus` — estado explícito del cargo
- `noShowById: string | null` — actor que marcó (null = sistema/night audit)
- `noShowAt: DateTime` — timestamp UTC del evento

### 3. Night audit = corte fiscal del día
`PropertySettings.noShowProcessedDate` es el sello del cierre del día para no-shows. Una vez procesado:
- No se pueden crear no-shows retroactivos para ese día sin intervención de administrador
- El reporte de no-shows del día es estático (los datos no cambian)
- Cualquier modificación post-corte queda en el audit trail de `StayJourney`

### 4. Aritmética de dinero
Usar siempre `Decimal` (Prisma/Decimal.js) para sumar, dividir o calcular fees. Nunca `number` nativo para operaciones monetarias.

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
│   │       │   ├── checkouts.service.ts      Lógica de negocio (2 fases + undo + cancel per-bed)
│   │       │   ├── checkouts.service.spec.ts 30 unit tests
│   │       │   ├── checkouts.controller.ts   7 endpoints
│   │       │   └── dto/                      BatchCheckoutDto, CreateCheckoutDto, CancelCheckoutDto
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
│   │       ├── reports/              Métricas del día + no-show report
│   │       ├── settings/             PropertySettings (timezone, checkout time, noShowCutoffHour)
│   │       ├── pms/
│   │       │   └── guest-stays/      GuestStay CRUD + markAsNoShow + revertNoShow
│   │       │       ├── guest-stays.service.ts    Lógica de negocio (no-show, checkAvailability, findOne)
│   │       │       ├── guest-stays.controller.ts GET /:id, POST /:id/no-show, POST /:id/revert-no-show
│   │       │       └── night-audit.scheduler.ts  Cron 30min, multi-timezone, noShowProcessedDate
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
│   │       │   ├── DailyPlanningPage.tsx       ★ Pantalla principal — ver sección Módulos
│   │       │   ├── ReservationDetailPage.tsx   ★ Detalle completo de reserva (/reservations/:id)
│   │       │   ├── KanbanPage.tsx              Vista supervisor (esqueleto)
│   │       │   ├── CheckoutsPage.tsx           Historial de checkouts
│   │       │   ├── DiscrepanciesPage.tsx       Lista de discrepancias abiertas
│   │       │   ├── ReportsPage.tsx             Métricas del día (?tab=housekeeping|noshow)
│   │       │   └── LoginPage.tsx
│   │       ├── components/
│   │       │   ├── Sidebar.tsx        GlobalTopBar (hamburger + [+] + calendario + bell + UserMenu)
│   │       │   ├── AppDrawer.tsx      Drawer de navegación lateral (hamburger)
│   │       │   └── UserMenu.tsx       Avatar con <User> icon → dropdown de cuenta
│   │       ├── modules/rooms/
│   │       │   ├── components/
│   │       │   │   ├── timeline/
│   │       │   │   │   ├── TimelineScheduler.tsx  ★ Componente raíz del calendario PMS
│   │       │   │   │   ├── BookingBlock.tsx        Bloque de reserva (drag, click, tooltip)
│   │       │   │   │   ├── BookingsLayer.tsx       Capa de render de bloques sobre el grid
│   │       │   │   │   ├── DateHeader.tsx          Cabecera de fechas (hoy = emerald highlight)
│   │       │   │   │   ├── RoomColumn.tsx          Columna izquierda de habitaciones
│   │       │   │   │   ├── TimelineSubBar.tsx      Controles (hoy/semana/mes, rango)
│   │       │   │   │   ├── TodayColumnHighlight.tsx Columna de hoy resaltada
│   │       │   │   │   ├── TooltipPortal.tsx       Tooltip de reserva (flip top/bottom)
│   │       │   │   │   └── NoShowConfirmModal.tsx  Modal confirmación no-show con badge OTA
│   │       │   │   └── dialogs/
│   │       │   │       └── BookingDetailSheet.tsx  Panel lateral 420px + ↗ Ver completa
│   │       │   ├── api/
│   │       │   │   └── guest-stays.api.ts      list, get, create, checkout, moveRoom
│   │       │   ├── hooks/
│   │       │   │   ├── useGuestStays.ts        Fetch + optimistic create + mutations
│   │       │   │   └── useTooltip.ts           Tooltip state + position (flip logic)
│   │       │   └── utils/
│   │       │       ├── timeline.constants.ts   TIMELINE, SOURCE_COLORS, OTA_ACCENT_COLORS
│   │       │       └── timeline.utils.ts       getStayStatus, otros helpers
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

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `batchCheckout` | `POST /checkouts/batch` | Fase 1: planificación matutina. Crea tasks PENDING con `hasSameDayCheckIn` per-bed |
| `confirmDeparture` | `POST /checkouts/:id/depart` | Fase 2: checkout físico. bedId-específico. PENDING→READY, push, SSE |
| `undoDeparture` | `POST /checkouts/:id/undo-depart` | Fase 2.5: revierte READY→PENDING. Solo pre-limpieza |
| `cancelCheckout` | `PATCH /checkouts/:id/cancel` | Extensión de estadía. Soporta bedId para cancel per-bed |
| `processCheckout` | `POST /checkouts` | Checkout individual ad-hoc (idempotente por cloudbedsReservationId) |
| `getDailyGrid` | `GET /planning/daily` | Grid del día. Filtra por checkout.actualCheckoutAt (inmune a tz) |
| `findByProperty` | `GET /checkouts` | Historial de checkouts |

**Tests:** 30 unit tests en `checkouts.service.spec.ts` — 30/30 PASS.

**Casos edge cubiertos:**
- Idempotencia por `cloudbedsReservationId` (webhooks duplicados)
- `confirmDeparture` con y sin `bedId` (dorm vs privada)
- Idempotencia de `confirmDeparture` (→ `{ alreadyDeparted: true }`)
- `cancelCheckout` con y sin `bedId` (per-bed vs full checkout)
- `cancelCheckout` con tareas `IN_PROGRESS` → alerta supervisor, NO cancela automáticamente
- `cancelCheckout` también cancela tareas `PENDING` (extensión antes de Fase 2)
- Per-bed cancel: no marca `checkout.cancelled = true` (el resto del checkout sigue)
- `getDailyGrid` filtra por `checkout.actualCheckoutAt` (no `createdAt`) — timezone-safe
- `getDailyGrid` incluye tareas CANCELLED (el frontend las muestra como EMPTY editables)

---

### ✅ DailyPlanningPage.tsx — COMPLETO

**Responsabilidad:** Pantalla de operaciones del recepcionista. Dos pestañas en una URL.

**Tab 1: "Planificación del Día"**
- Grid tipo pizarra. Cada celda = una cama.
- Click cicla: `EMPTY → CHECKOUT → EMPTY` (urgente via botón secundario)
- Botón "Confirmar Planificación" → `POST /checkouts/batch`
- Banner 1-línea `✅ Planificación confirmada — solo lectura` post-confirmación
- Celdas con tareas activas se bloquean. Celdas con tareas CANCELLED son editables.

**Tab 2: "Estado en Tiempo Real"**
- Muestra el progreso de las salidas confirmadas
- Tab deshabilitada hasta que se confirme la planificación
- **Dormitorios:** RoomAccordion expandible con RealtimeBedChip por cama activa
- **Habitaciones Privadas:** Grid responsivo (`grid-cols-2 sm:3 md:4`) sin accordion (1 cama = directo)
- Acciones por estado del chip:
  - `PENDING_DEPARTURE`: "Toca cuando salga →" + "Cancelar checkout"
  - `READY_TO_CLEAN`: "Esperando housekeeper" + "↩ Revertir salida"
  - `CLEANING` / `CLEAN`: Solo lectura

**Componentes internos (todos en el mismo archivo):**
- `PlanningTable` — tabla de rooms/camas con override local
- `PlanningRow` — fila de una habitación (dorm o privada)
- `RealtimeSection` — grid de tiempo real por habitación
- `RealtimeBedChip` — chip de cama con máquina de estados visual y acciones inline
- `DepartureModal` — confirmación de salida física (Fase 2)
- `CancelModal` — confirmación de cancelación per-bed (gris/rojo)
- `UndoModal` — confirmación de reversión de salida (amber)
- `DiscrepancyBanner` — alerta de discrepancias abiertas

**Lógica de estado clave:**
```typescript
// planningIsDone se deriva del servidor — NUNCA de useState
const planningIsDone =
  allBeds.some((b) => !!b.taskId && !b.cancelled) ||
  localStorage.getItem('planning-no-checkout-confirmed') === TODAY

// getState: servidor manda si hay tarea activa; override si no
function getState(roomId, bedId, cell) {
  if (cell.taskId && !cell.cancelled) return inferState(cell)
  return overrides.get(cellKey(roomId, bedId))?.state ?? inferState(cell)
}

// cycleState/toggleUrgente: cell.taskId && !cell.cancelled (no solo cell.taskId)
// Permite re-planificar camas con tareas canceladas

// Tab via URL — persiste entre navegaciones
const activeTab = searchParams.get('tab') ?? 'planning'
```

---

### ✅ GuestStaysService — COMPLETO (Sesión 6)

**Responsabilidad:** CRUD de estadías de huéspedes. Punto de entrada del módulo PMS.

**Métodos:**

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `create` | `POST /v1/guest-stays` | Alta de reserva con validación de disponibilidad |
| `findOne` | `GET /v1/guest-stays/:id` | Detalle de una reserva, incluye `room.number` |
| `findByProperty` | `GET /v1/guest-stays` | Lista de estadías por propiedad y rango de fechas |
| `checkAvailability` | `GET /v1/guest-stays/availability` | Pre-flight sin efectos secundarios |
| `checkout` | `POST /v1/guest-stays/:id/checkout` | Cierra la estadía, actualiza room status |
| `moveRoom` | `PATCH /v1/guest-stays/:id/move-room` | Traslado de habitación mid-stay |
| `markAsNoShow` | `POST /v1/guest-stays/:id/no-show` | Marca no-show con audit trail fiscal |
| `revertNoShow` | `POST /v1/guest-stays/:id/revert-no-show` | Revierte dentro de ventana de 48h |

**Decisión importante — orden de rutas:**
`@Get('availability')` declarado ANTES de `@Get(':id')` en el controller para evitar que NestJS interprete el string `"availability"` como un `:id` param.

---

### ✅ Calendario PMS (TimelineScheduler) — COMPLETO (Sesión 6)

**Responsabilidad:** Vista de calendario tipo Cloudbeds/Mews para el módulo PMS (`/pms`). Muestra todas las reservas activas en un grid habitación × día.

**Componentes clave:**

| Componente | Responsabilidad |
|------------|-----------------|
| `TimelineScheduler.tsx` | Raíz — coordina state, scroll, mutations, modales |
| `BookingBlock.tsx` | Bloque de reserva en el grid. Soporta drag horizontal, tooltip, click para panel |
| `BookingsLayer.tsx` | Render virtual de todos los bloques sobre el grid de fechas |
| `DateHeader.tsx` | Cabecera de días con highlight del día actual (emerald) |
| `RoomColumn.tsx` | Columna izquierda fija con nombre/número de habitación y estado |
| `TimelineSubBar.tsx` | Barra de controles: HOY / ← → / Semana / Mes |
| `TodayColumnHighlight.tsx` | Columna de hoy con fondo sutil `rgba(16,185,129,0.06)` |
| `TooltipPortal.tsx` | Portal de tooltip flotante (flips top↔bottom según posición) |
| `NoShowConfirmModal.tsx` | Modal de confirmación de no-show con badge OTA y advertencia |
| `BookingDetailSheet.tsx` | Panel lateral 420px — detalle de reserva con tabs segmentadas |

**Flujo de interacción completo:**
```
Click en bloque → BookingBlock.handleMouseDown
  ├─ Si isPast (reserva anterior): escucha solo mouseup → abre BookingDetailSheet
  ├─ Si arrastrar: actualiza posición → suelta → mutation moveRoom/extend
  └─ Si click normal: show() tooltip → tooltip muestra acciones

Tooltip acciones:
  ├─ "Abrir detalle" → setDetailStay → BookingDetailSheet
  ├─ "Marcar no-show" → hide() + setNoShowDialog → NoShowConfirmModal
  └─ hover prolongado sin click → auto-show tooltip

BookingDetailSheet header:
  ├─ "↗ Ver completa" → navigate(/reservations/:id)
  └─ "×" → onClose()
```

**Patrones críticos del calendario:**

1. **Stacking context isolation** — el div del grid tiene `z-0` para crear un stacking context aislado. Esto garantiza que `RoomColumn` (`z-[25]`) siempre pinte encima de los bloques de reserva sin importar el z-index de estos.

2. **Tooltip flip** — `calculatePosition()` en `useTooltip.ts` detecta si `rect.top < 280` y cambia el placement de `'top'` a `'bottom'`. `TooltipPortal` ajusta el `transform` según el placement.

3. **Past guests** — huéspedes pasados (`isPast = true`) NO activan drag. En `handleMouseDown` se registra un `mouseup` listener one-shot para disparar `onClick()` sin pasar por la lógica de drag.

4. **Color tokens** — el proyecto **NO tiene** token `brand-*` en `tailwind.config.js`. Todos los highlights de hoy usan `emerald` directamente (`bg-emerald-50`, `text-emerald-700`, `bg-emerald-600`).

5. **No-show flow** — al clicar "Marcar no-show" en el tooltip, se llama `hide()` primero para cerrar el tooltip ANTES de abrir el modal. Sin este orden el tooltip queda stuck.

---

### ✅ ReservationDetailPage — COMPLETO (Sesión 6)

**Ruta:** `/reservations/:id`

**Responsabilidad:** Página de detalle completo de una reserva. Nivel 2 en la arquitectura de dos niveles (panel 420px = nivel 1, página completa = nivel 2). Patrón NNG progressive disclosure.

**Estructura de la página:**
```
[← Volver]

┌────────────────────────────────────────────────┐
│  [OTA stripe de color]                          │
│  [Status badge] [OTA badge]                     │
│  Nombre del huésped                             │
│  Hab. 101                                       │
│                  [Revertir no-show] [Checkout]  │
├────────────────────────────────────────────────┤
│  Check-in    Check-out    Noches    Huéspedes   │  ← quick-stats bar
└────────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ [Estadía] [Pago] [Huésped] [Historial]       │  ← segmented control
├──────────────────────────────────────────────┤
│ Tab Estadía: fechas, hab, canal, IDs, notas   │
│ Tab Pago: totales, progress bar, paymentStatus │
│ Tab Huésped: nombre, teléfono, email, doc      │
│ Tab Historial: timeline de eventos (audit)     │
└──────────────────────────────────────────────┘
```

**Fuente de datos:** `GET /v1/guest-stays/:id` → `GuestStayDto` (con `room.number` incluido).

**Decisión de diseño — botones de acción navegan a `/pms`:**
Las mutaciones de checkout y revert-no-show no están disponibles en la página de detalle standalone. Al clickar, el usuario vuelve al calendario PMS donde las acciones están en contexto (con el panel lateral abierto). Esto es intencional — las acciones críticas requieren el contexto del calendario.

---

### ✅ TasksService — COMPLETO

**Responsabilidad:** Ciclo de vida de una `CleaningTask` una vez activada.

**Tests:** 19 unit tests en `tasks.service.spec.ts` — 19/19 PASS.

---

### ✅ NotificationsService (SSE) — COMPLETO

**Responsabilidad:** Stream SSE por `propertyId`. El dashboard web se suscribe en `GET /api/events`.

**Eventos SSE implementados:**
| Evento | Cuándo se emite |
|--------|----------------|
| `task:planned` | Después de `batchCheckout` o `undoDeparture` exitoso |
| `task:ready` | Después de `confirmDeparture` exitoso |
| `task:started` | Housekeeper inicia limpieza |
| `task:done` | Housekeeper termina limpieza |
| `task:unassigned` | Tarea queda sin asignar |
| `task:cancelled` | Checkout cancelado (full o per-bed) |
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

## Module Relationships & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FLUJO DE DATOS PRINCIPAL                            │
│                                                                             │
│  Web (DailyPlanningPage)                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │ GET /planning/daily ──────────────────→ CheckoutsService         │        │
│  │   filtro: checkout.actualCheckoutAt     (rooms × beds × tasks)  │        │
│  │                                                                  │        │
│  │ POST /checkouts/batch ────────────────→ CheckoutsService         │        │
│  │   { items[{bedId, hasSameDayCheckIn}] } crea Task(PENDING)/cama │        │
│  │                                         hasSameDayCheckIn per-bed│        │
│  │                                         emite SSE task:planned  │        │
│  │                                                                  │        │
│  │ POST /checkouts/:id/depart ───────────→ CheckoutsService         │        │
│  │   { bedId }           confirmDeparture() activa Task(READY)      │        │
│  │                                         bed → DIRTY, push, SSE  │        │
│  │                                                                  │        │
│  │ POST /checkouts/:id/undo-depart ──────→ CheckoutsService         │        │
│  │   { bedId }           undoDeparture()   READY → PENDING          │        │
│  │                                         bed → OCCUPIED, push    │        │
│  │                                                                  │        │
│  │ PATCH /checkouts/:id/cancel ──────────→ CheckoutsService         │        │
│  │   { bedId? }          cancelCheckout()  per-bed o full cancel    │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                             │
│  SSE stream ──────────────────────────────→ useSSE() → invalidateQueries   │
│  (GET /events?token=...)                     actualiza DailyPlanningGrid    │
│                                                                             │
│  Mobile (RoomsScreen)                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │ GET /tasks ──────────────────────────→ TasksService.findMine()  │        │
│  │ POST /tasks/:id/start ────────────────→ TasksService.startTask()│        │
│  │ POST /tasks/:id/end ──────────────────→ TasksService.endTask()  │        │
│  │                                         emite SSE task:done    │        │
│  └─────────────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘

Relaciones Prisma clave:
  Property → Room[] → Bed[] → CleaningTask[] → TaskLog[]
  Checkout → CleaningTask[] (un checkout, N tareas)
  CleaningTask.hasSameDayCheckIn (per-bed, no per-checkout)
  HousekeepingStaff → CleaningTask[] (assignedTo) | verifiedTasks | taskLogs
```

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

## Pending Tasks (Etapa 1 — operativo actual)

### Alta prioridad (bloquean flujo operativo)

**1. KanbanPage — vista supervisor de tareas**
- Columnas: `UNASSIGNED → READY → IN_PROGRESS → PAUSED → DONE → VERIFIED`
- Cards con: room/bed, housekeeper asignado, tiempo transcurrido, prioridad
- Filtros por piso, housekeeper, estado
- Asignación manual: `<select>` de staff en cards UNASSIGNED
- Sin esto, el supervisor opera ciego

**2. ReservationDetailPage — acciones funcionales**
- Los botones "Checkout" y "Revertir no-show" actualmente navegan a `/pms` (redirect). Necesitan ejecutar las mutaciones directamente desde la página de detalle.
- Requiere conectar `useCheckout` y `useRevertNoShow` al contexto de `propertyId` correcto fuera del `TimelineScheduler`.

**3. Mobile — screens pendientes**
- `DiscrepancyReportScreen` — formulario tipo/descripción + foto opcional
- `NoteScreen` — agregar nota de limpieza a una tarea
- `MaintenanceIssueScreen` — reportar problema de mantenimiento con foto

### Media prioridad

**4. DiscrepanciesPage web — flujo de resolución**
- `PATCH /discrepancies/:id/resolve` (endpoint existe, UI no)

**5. WebSocket/SSE para mobile**
- La mobile usa polling. Debería usar push para actualizaciones en tiempo real.

### Baja prioridad

**6. Tests E2E con Supertest**

**7. CI/CD pipeline**

**8. CloudBeds webhook handler con verificación HMAC**

---

## Roadmap — Etapa 2 (Propuestas de Estudio de Mercado)

Propuestas priorizadas basadas en análisis competitivo de Mews, Opera Cloud, Cloudbeds, Clock PMS+, Guesty, Flexkeeping y Optii. Cada propuesta incluye el diseño técnico de implementación.

### 🔴 Alta Prioridad — Table-stakes de la industria

---

#### P1. Tareas de limpieza stayover (estadías largas)

**Problema operativo:** El sistema solo genera tareas por checkout. Los housekeepers dedican ~60% del día limpiando habitaciones OCUPADAS (stayovers). Sin esto, el sistema cubre menos de la mitad de la operación real.

**Referencia:** Opera, Cloudbeds (rules), Clock PMS+, Guesty, Hostaway — todos generan tareas stayover automáticamente.

**Diseño técnico:**

1. **Schema Prisma — nueva config y tipo de tarea:**
```prisma
// En PropertySettings (ya existe):
model PropertySettings {
  // ... campos existentes ...
  stayoverFrequency   StayoverFrequency @default(DAILY)
  stayoverStartTime   String            @default("09:00")  // hora local para generar tareas
}

// Nuevo enum:
enum StayoverFrequency {
  DAILY           // limpieza diaria para todas las camas ocupadas
  EVERY_2_DAYS    // día sí, día no (basado en checkInDate)
  ON_REQUEST      // solo si el huésped lo solicita (ver P7)
}

// En CleaningTask — TaskType ya existe:
enum TaskType {
  CLEANING    // checkout cleaning (actual)
  STAYOVER    // mid-stay cleaning (nuevo)
  TURNDOWN    // futuro: servicio de noche
  INSPECTION  // futuro: inspección sin limpieza
}
```

2. **Nuevo servicio `StayoverService`:**
```
apps/api/src/stayover/
├── stayover.service.ts       Lógica de generación de tareas stayover
├── stayover.scheduler.ts     Cron job que ejecuta diariamente
└── stayover.module.ts
```

- **Cron job** (`@Cron('0 9 * * *')` configurable por property): Cada mañana, para cada `Bed` con `status: OCCUPIED` que NO tenga un checkout planificado para hoy:
  - Verificar frecuencia: si `EVERY_2_DAYS`, calcular `(today - checkInDate) % 2 === 0`
  - Si `ON_REQUEST`, saltar (se genera solo manualmente o desde preferencia del huésped)
  - Crear `CleaningTask({ bedId, taskType: STAYOVER, status: UNASSIGNED, priority: LOW })`
  - Stayovers NO pasan por el checkout de 2 fases — se crean directamente como UNASSIGNED
  - Prioridad: `LOW` por defecto (checkouts tienen `MEDIUM`/`URGENT`)

3. **getDailyGrid update:** Incluir tareas `STAYOVER` en la respuesta. El frontend las muestra con un color/badge diferenciado (ej: azul "🔵 Limpieza de estadía") en el tab de Tiempo Real.

4. **KanbanPage:** Las tareas stayover aparecen en la columna UNASSIGNED con badge visual `STAYOVER`. El supervisor las asigna junto con las de checkout.

5. **Mobile:** La lista de tareas del housekeeper muestra stayovers con indicador visual diferente. El flujo start→end es idéntico.

---

#### P2. Checklists de limpieza por tipo de habitación

**Problema operativo:** No hay estandarización de qué debe limpiarse en cada tipo de habitación. Calidad inconsistente. El supervisor no puede verificar qué pasos se completaron.

**Referencia:** Opera (checklists por room type), Clock PMS+ (checklists configurables), Breezeway (checklists con foto por item), Flexkeeping.

**Diseño técnico:**

1. **Schema Prisma:**
```prisma
model CleaningChecklist {
  id          String   @id @default(uuid())
  propertyId  String
  roomType    RoomType                    // SHARED, PRIVATE, SUITE, etc.
  taskType    TaskType @default(CLEANING) // checklist distinto para STAYOVER vs CHECKOUT
  name        String                      // "Checkout — Dormitorio", "Stayover — Suite"
  items       CleaningChecklistItem[]
  property    Property @relation(fields: [propertyId], references: [id])
  createdAt   DateTime @default(now())

  @@unique([propertyId, roomType, taskType])
}

model CleaningChecklistItem {
  id            String   @id @default(uuid())
  checklistId   String
  label         String                    // "Cambiar sábanas", "Limpiar baño", "Reponer amenities"
  sortOrder     Int
  requiresPhoto Boolean  @default(false)  // para items críticos: "foto del baño terminado"
  checklist     CleaningChecklist @relation(fields: [checklistId], references: [id])
}

model ChecklistResponse {
  id        String   @id @default(uuid())
  taskId    String
  itemId    String
  completed Boolean  @default(false)
  photoUrl  String?                       // si requiresPhoto: URL de la foto subida
  completedAt DateTime?
  task      CleaningTask @relation(fields: [taskId], references: [id])
  item      CleaningChecklistItem @relation(fields: [itemId], references: [id])

  @@unique([taskId, itemId])
}
```

2. **API — nuevo módulo `checklists/`:**
```
apps/api/src/checklists/
├── checklists.service.ts       CRUD de templates + respuestas
├── checklists.controller.ts    GET /checklists/:roomType, POST /tasks/:id/checklist
└── dto/
```

- `GET /checklists?roomType=SHARED&taskType=CLEANING` → devuelve el template aplicable
- `POST /tasks/:id/checklist` → `{ items: [{ itemId, completed, photoUrl? }] }` — guarda respuestas
- `endTask()` en TasksService: **validar** que todos los items `required` estén completados antes de permitir `DONE`

3. **Mobile UI:**
- Pantalla de tarea `task/[id].tsx`: entre los botones "Iniciar" y "Finalizar", mostrar la lista de checklist items como checkboxes
- Items con `requiresPhoto: true` muestran un botón de cámara (Expo ImagePicker)
- El botón "Finalizar" se habilita solo cuando todos los items obligatorios están marcados
- Diseño: lista vertical con checkmarks, agrupada por categoría si hay muchos items

4. **Web — Supervisor:**
- KanbanPage: card de tarea muestra progreso del checklist: "4/7 items ✓"
- Al verificar (DONE→VERIFIED), el supervisor puede ver las fotos adjuntas

5. **Web — Settings:**
- Página de configuración para crear/editar checklists por room type
- Drag-and-drop para reordenar items (sortOrder)

---

#### P3. Auto-asignación de tareas

**Problema operativo:** Todas las tareas quedan `UNASSIGNED` y alguien debe asignar manualmente cada una. Con 20+ camas/día, esto es un bottleneck. `assignTask` existe en `TasksService` pero no hay lógica de distribución.

**Referencia:** Opera (sección-based con créditos), Guesty (round-robin), Clock PMS+ (secciones por piso).

**Diseño técnico — 3 estrategias progresivas:**

1. **Estrategia 1: Por sección (MVP recomendado)**

```prisma
model StaffSection {
  id        String   @id @default(uuid())
  staffId   String
  roomId    String                        // habitación asignada a este housekeeper
  staff     HousekeepingStaff @relation(fields: [staffId], references: [id])
  room      Room @relation(fields: [roomId], references: [id])

  @@unique([staffId, roomId])
}
```

- Configuración en web: drag-and-drop de habitaciones a housekeepers (o multi-select)
- `batchCheckout` auto-asigna: al crear cada tarea, buscar `StaffSection` donde `roomId = task.bed.roomId` → `assignedToId = section.staffId`
- Si no hay sección configurada → queda UNASSIGNED (fallback manual)
- UI: página "Personal → Secciones" para configurar asignaciones fijas

2. **Estrategia 2: Round-robin**

- Sin configuración. Al crear tareas, distribuir equitativamente entre housekeepers con `role: HOUSEKEEPER` y `isActive: true`
- Algoritmo: `SELECT staffId, COUNT(tasks today) FROM ... GROUP BY staffId ORDER BY count ASC LIMIT 1`
- Menos control pero zero-config

3. **Estrategia 3: Por créditos (avanzado, inspirado en Opera)**

```prisma
model RoomType {
  // añadir:
  cleaningCredits  Float @default(1.0)    // Dorm cama = 0.5, Suite = 2.0, Estándar = 1.0
}
```

- Cada housekeeper tiene un target de créditos por turno (ej: 12 créditos)
- El algoritmo balancea la carga total por créditos, no por cantidad de tareas
- Requiere UI de configuración de créditos por room type + target por staff

**Recomendación:** Implementar Estrategia 1 (secciones) primero. Es la más intuitiva para propiedades pequeñas-medianas y cubre el 80% de los casos. Round-robin como fallback si no hay secciones configuradas.

---

#### P4. KanbanPage — vista supervisor de tareas

**Problema operativo:** Sin esta pantalla, el supervisor no puede ver qué camareras están haciendo qué. Actualmente existe como esqueleto placeholder.

**Referencia:** Mews (grid por piso), Opera Cloud (housekeeping board), Clock PMS+ (grid + floor plan).

**Diseño técnico:**

1. **API:**
- `GET /tasks?date=YYYY-MM-DD&propertyId=X` → todas las tareas del día con bed, room, assignedTo, logs
- `PUT /tasks/:id/assign` → ya existe
- `POST /tasks/:id/verify` → ya existe

2. **Web — KanbanPage.tsx:**

```
┌─ UNASSIGNED ─┐ ┌── READY ────┐ ┌─ IN_PROGRESS ┐ ┌── DONE ─────┐ ┌─ VERIFIED ──┐
│              │ │             │ │              │ │             │ │             │
│ ┌──────────┐ │ │ ┌─────────┐│ │ ┌──────────┐ │ │ ┌─────────┐│ │ ┌─────────┐│
│ │ Dorm1    │ │ │ │ 101     ││ │ │ Dorm1    │ │ │ │ 102     ││ │ │ Dorm2   ││
│ │ Cama 2   │ │ │ │ Cama 1  ││ │ │ Cama 3   │ │ │ │ Cama 1  ││ │ │ Cama 1  ││
│ │ CHECKOUT │ │ │ │ María G ││ │ │ Ana P    │ │ │ │ María G ││ │ │ Ana P   ││
│ │ ───────  │ │ │ │ 🔴 URG  ││ │ │ 12min ⏱  │ │ │ │ 22min   ││ │ │ ✓ Sup.  ││
│ │ [Asignar]│ │ │ └─────────┘│ │ └──────────┘ │ │ └─────────┘│ │ └─────────┘│
│ └──────────┘ │ │             │ │              │ │             │ │             │
└──────────────┘ └─────────────┘ └──────────────┘ └─────────────┘ └─────────────┘

Filtros: [Piso ▾] [Housekeeper ▾] [Tipo ▾]     Resumen: 2 pendientes · 1 limpiando · 1 lista
```

- **Card data:** room number, bed label, task type badge (CHECKOUT/STAYOVER), housekeeper name, priority indicator, elapsed time (derivado de TaskLog timestamps)
- **Acciones:** Cards UNASSIGNED tienen `<select>` de staff. Cards DONE tienen botón "Verificar".
- **Actualización:** SSE events invalidan el query → React Query refresca automáticamente
- **Responsive:** En mobile, las columnas se convierten en tabs o acordeones

---

### 🟡 Media Prioridad — Diferenciadores premium

---

#### P5. Métricas de rendimiento

**Problema operativo:** No hay datos para evaluar eficiencia del equipo ni para planificar turnos. El supervisor no sabe qué housekeeper es más rápido, ni cuánto tarda en promedio cada tipo de habitación.

**Referencia:** Opera (performance analytics nativo), Optii (AI-driven insights adquirido por Amadeus), Flexkeeping (dashboards de productividad).

**Diseño técnico:**

1. **Fuente de datos:** `TaskLog` ya almacena timestamps por evento (CREATED, READY, STARTED, DONE, VERIFIED). El tiempo de limpieza se calcula: `TaskLog(DONE).createdAt - TaskLog(STARTED).createdAt`.

2. **API — endpoint `GET /reports/performance`:**
```typescript
// Parámetros: ?from=2026-03-01&to=2026-03-22&propertyId=X
// Respuesta:
{
  summary: {
    totalTasks: 142,
    avgCleaningMinutes: 18.3,
    avgByRoomType: { SHARED: 12.1, PRIVATE: 24.7 },
    avgByTaskType: { CLEANING: 22.4, STAYOVER: 14.1 },
  },
  byStaff: [
    { staffId, name, tasksCompleted: 47, avgMinutes: 16.8, fastest: 8, slowest: 34 },
    ...
  ],
  byDay: [
    { date: '2026-03-22', tasks: 12, avgMinutes: 17.2 },
    ...
  ]
}
```

3. **Web — ReportsPage.tsx:**
- Gráfica de barras: tareas completadas por día (últimos 7/30 días)
- Tabla comparativa de staff: avg time, total tasks, fastest/slowest
- Gráfica de tendencia: avg cleaning time por semana (para detectar mejoras o degradación)
- Filtros: rango de fechas, room type, task type

4. **Dependencia:** Requiere que `TaskLog` tenga datos reales de producción. Los datos de seed son insuficientes para métricas significativas.

---

#### P6. Preferencias de limpieza del huésped

**Problema operativo:** Post-COVID, las cadenas hoteleras (Marriott, Hilton, IHG) migraron a limpieza opt-in. Las propiedades necesitan respetar la preferencia del huésped para reducir costos laborales y comunicar sostenibilidad.

**Referencia:** Actabl/Alice (guest preferences), Intelity (QR-based preferences), estándar en cadenas hoteleras desde 2022.

**Diseño técnico:**

1. **Schema Prisma:**
```prisma
enum CleaningPreference {
  DAILY           // limpieza cada día (default actual)
  EVERY_2_DAYS    // cada 2 días
  CHECKOUT_ONLY   // solo al checkout (opt-out de stayover)
  ON_REQUEST      // solo cuando lo pida
}

// Opción A — en la reserva (si hay integración PMS):
model Reservation {
  bedId               String
  guestName           String
  checkInDate         DateTime
  expectedCheckout    DateTime
  cleaningPreference  CleaningPreference @default(DAILY)
  // ...
}

// Opción B — standalone (sin integración PMS):
model GuestPreference {
  id        String   @id @default(uuid())
  bedId     String
  date      DateTime
  preference CleaningPreference
  source    String   // 'QR', 'RECEPTION', 'APP'
  bed       Bed @relation(fields: [bedId], references: [id])
}
```

2. **Flujo de captura:**
- **QR en habitación:** El huésped escanea un QR que abre una página web simple (no requiere app). Selecciona su preferencia. Se guarda en `GuestPreference`.
- **Recepción al check-in:** El recepcionista pregunta y registra.
- **API:** `POST /preferences { bedId, preference, source }`

3. **Integración con StayoverService (P1):**
- El cron job de stayover consulta `GuestPreference` antes de generar la tarea:
  - `CHECKOUT_ONLY` → no genera stayover
  - `EVERY_2_DAYS` → genera solo en días pares desde check-in
  - `ON_REQUEST` → no genera automáticamente (solo manual)
  - `DAILY` → genera normalmente

4. **Visualización:**
- DailyPlanningGrid: badge "🌿 Opt-out" en camas con preferencia != DAILY
- KanbanPage: la tarea no aparece si el huésped optó out

---

#### P7. Reportes de mantenimiento desde el móvil — Integración con módulo de Mantenimiento

**Contexto arquitectónico:** El módulo de Housekeeping es un engrane dentro del PMS completo. Se comunica **monolíticamente** con el módulo de Mantenimiento. El módulo de Mantenimiento es un sistema de tickets completo para levantar, gestionar y dar seguimiento a tareas de mantenimiento.

**Problema operativo:** Los housekeepers son los "ojos" del hotel — entran a cada habitación diariamente. Detectan problemas (grifos rotos, manchas, focos fundidos) pero no tienen un canal estructurado para reportarlos. Los reportes se pierden en notas de papel o mensajes de WhatsApp.

**Referencia:** Flexkeeping (operaciones unificadas cross-departamento), hotelkit (red social interna + tareas), Opera (work orders integrados), Actabl (maintenance routing).

**Diseño técnico:**

1. **Schema Prisma — Sistema de tickets de mantenimiento:**

```prisma
// ── Módulo de Mantenimiento (tickets) ──────────────────────────

enum TicketStatus {
  OPEN              // recién creado
  ACKNOWLEDGED      // mantenimiento lo vio
  IN_PROGRESS       // trabajando en ello
  WAITING_PARTS     // esperando material/proveedor
  RESOLVED          // trabajo completado
  VERIFIED          // supervisor confirmó la resolución
  CLOSED            // archivado
}

enum TicketPriority {
  LOW               // cosmético, no urgente
  MEDIUM            // funcional pero no bloquea la habitación
  HIGH              // afecta la experiencia del huésped
  CRITICAL          // habitación inhabitable (sin agua, sin luz, etc.)
}

enum TicketCategory {
  PLUMBING          // fontanería
  ELECTRICAL        // eléctrico
  FURNITURE         // mobiliario roto/dañado
  APPLIANCE         // electrodomésticos
  HVAC              // climatización
  STRUCTURAL        // paredes, techo, piso
  COSMETIC          // pintura, manchas, estética
  SAFETY            // seguridad (cerraduras, detectores)
  OTHER
}

model MaintenanceTicket {
  id              String          @id @default(uuid())
  propertyId      String
  roomId          String
  bedId           String?                        // null si aplica a toda la habitación
  category        TicketCategory
  priority        TicketPriority  @default(MEDIUM)
  status          TicketStatus    @default(OPEN)
  title           String                          // "Grifo gotea en baño"
  description     String?                         // detalle libre
  reportedById    String                          // housekeeper que lo detectó
  assignedToId    String?                         // técnico de mantenimiento asignado
  resolvedById    String?                         // quien lo resolvió
  verifiedById    String?                         // supervisor que verificó

  estimatedMinutes Int?                           // estimación del trabajo
  actualMinutes    Int?                           // tiempo real registrado

  // Timestamps del ciclo de vida
  acknowledgedAt   DateTime?
  startedAt        DateTime?
  resolvedAt       DateTime?
  verifiedAt       DateTime?
  closedAt         DateTime?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  // Relaciones
  property     Property          @relation(fields: [propertyId], references: [id])
  room         Room              @relation(fields: [roomId], references: [id])
  bed          Bed?              @relation(fields: [bedId], references: [id])
  reportedBy   HousekeepingStaff @relation("TicketsReported", fields: [reportedById], references: [id])
  assignedTo   HousekeepingStaff? @relation("TicketsAssigned", fields: [assignedToId], references: [id])
  resolvedBy   HousekeepingStaff? @relation("TicketsResolved", fields: [resolvedById], references: [id])
  verifiedBy   HousekeepingStaff? @relation("TicketsVerified", fields: [verifiedById], references: [id])
  photos       TicketPhoto[]
  comments     TicketComment[]
  logs         TicketLog[]

  // Vínculo con housekeeping (el ticket fue reportado durante esta tarea)
  sourceTaskId String?
  sourceTask   CleaningTask? @relation(fields: [sourceTaskId], references: [id])

  @@index([propertyId, status])
  @@index([assignedToId, status])
}

model TicketPhoto {
  id        String   @id @default(uuid())
  ticketId  String
  url       String                              // S3/Cloudinary URL
  caption   String?
  uploadedById String
  createdAt DateTime @default(now())
  ticket    MaintenanceTicket @relation(fields: [ticketId], references: [id])
}

model TicketComment {
  id        String   @id @default(uuid())
  ticketId  String
  authorId  String
  content   String
  createdAt DateTime @default(now())
  ticket    MaintenanceTicket @relation(fields: [ticketId], references: [id])
  author    HousekeepingStaff @relation(fields: [authorId], references: [id])
}

model TicketLog {
  id        String   @id @default(uuid())
  ticketId  String
  event     String                              // 'CREATED', 'ACKNOWLEDGED', 'ASSIGNED', 'STARTED', 'RESOLVED', etc.
  staffId   String?
  metadata  Json?                               // datos extra del evento
  createdAt DateTime @default(now())
  ticket    MaintenanceTicket @relation(fields: [ticketId], references: [id])
}
```

2. **API — módulo `maintenance/`:**
```
apps/api/src/maintenance/
├── maintenance.service.ts       Lógica CRUD + máquina de estados del ticket
├── maintenance.controller.ts    Endpoints REST
├── dto/
│   ├── create-ticket.dto.ts     { roomId, bedId?, category, priority, title, description }
│   └── update-ticket.dto.ts     { status, assignedToId?, comment? }
└── maintenance.module.ts
```

**Endpoints:**

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST /maintenance/tickets` | Crear ticket (desde mobile durante limpieza) |
| `GET /maintenance/tickets` | Lista con filtros (status, priority, room, assigned) |
| `GET /maintenance/tickets/:id` | Detalle con fotos, comments, logs |
| `PATCH /maintenance/tickets/:id` | Cambiar status, asignar técnico |
| `POST /maintenance/tickets/:id/comments` | Agregar comentario |
| `POST /maintenance/tickets/:id/photos` | Subir foto (antes/después de reparación) |

**Máquina de estados del ticket:**
```
OPEN → ACKNOWLEDGED → IN_PROGRESS → RESOLVED → VERIFIED → CLOSED
                    ↘ WAITING_PARTS → IN_PROGRESS
```

3. **Mobile — flujo de reporte rápido desde tarea de limpieza:**
- En `task/[id].tsx`, botón "⚠️ Reportar problema"
- Abre pantalla rápida: categoría (select), foto (cámara), nota breve
- `POST /maintenance/tickets` con `sourceTaskId` para vincular con la tarea de limpieza
- La foto se sube a S3/Cloudinary vía `POST /uploads` (nuevo endpoint para archivos)
- Notificación push al supervisor de mantenimiento
- SSE: `maintenance:ticket:created`

4. **Web — página de Mantenimiento (nuevo):**
- **Vista lista/tabla:** Todos los tickets filtrados por status, prioridad, habitación
- **Vista Kanban:** Columnas por TicketStatus (similar a KanbanPage de housekeeping)
- **Detalle de ticket:** Timeline de eventos (logs), fotos antes/después, comments, asignación
- **Dashboard de métricas:** Tickets abiertos, tiempo promedio de resolución, backlog por categoría

5. **Comunicación monolítica Housekeeping ↔ Mantenimiento:**
- `MaintenanceTicket.sourceTaskId` vincula el ticket con la tarea de limpieza que lo originó
- Si un ticket `CRITICAL` está abierto para una habitación, `getDailyGrid` lo muestra como badge "🔧 Mtto pendiente" en la celda — el recepcionista sabe que esa habitación NO está disponible
- Al resolver un ticket, si hay una `CleaningTask` pendiente para esa habitación, se notifica al housekeeper que la habitación ya es accesible
- **No es microservicio:** ambos módulos comparten la misma base de datos, el mismo NestJS, los mismos guards de auth. La separación es a nivel de módulos NestJS (import/export), no de servicios independientes.

---

### 🟢 Baja Prioridad — Innovación y futuro

---

#### P8. IA para optimización de rutas y secuencia de limpieza

**Problema operativo:** Los housekeepers limpian habitaciones en orden aleatorio o por proximidad intuitiva. Con datos históricos suficientes, un algoritmo puede generar la secuencia óptima que minimiza tiempo muerto entre habitaciones y prioriza correctamente las urgencias.

**Referencia:** Optii Solutions (adquirido por Amadeus, 2022) — reportan 15-20% de ganancia en eficiencia. El core es un algoritmo que considera: tiempo de limpieza histórico por room type, disposición física del edificio, hora de checkout predicha, y hora de llegada del próximo huésped.

**Diseño técnico (alto nivel — requiere volumen de datos para ser viable):**

1. **Prerequisitos:**
   - P1 (Stayover) y P3 (Auto-asignación) implementados
   - Al menos 30 días de datos reales de `TaskLog` (timestamps start/end por room type y housekeeper)
   - Modelo de proximidad entre habitaciones (floor + ala + distancia, o simplemente floor grouping)

2. **Fase 1 — Heurística simple (sin ML):**
   - Ordenar tareas asignadas a cada housekeeper por: (a) prioridad URGENT primero, (b) mismo piso juntas, (c) checkouts antes de stayovers
   - Implementable como un `sortTasks()` en `StaffSection` que reordena la cola del housekeeper
   - Mobile muestra las tareas en el orden optimizado

3. **Fase 2 — Modelo predictivo (con datos):**
   - Entrenar un modelo simple (regresión lineal o gradient boosting) que predice `cleaningMinutes` basado en: `roomType`, `taskType`, `staffId`, `dayOfWeek`, `isCheckout`, `bedCount`
   - Usar las predicciones para calcular la secuencia que minimiza el makespan total (tiempo desde primera tarea hasta última)
   - Algoritmo: variante de Traveling Salesman con pesos temporales + restricciones de prioridad

4. **Infraestructura:**
   - Fase 1: puro TypeScript en el backend, sin dependencias externas
   - Fase 2: Python microservice para ML (scikit-learn / XGBoost), comunicación via HTTP interno. O usar un servicio cloud (AWS SageMaker, Google Vertex) para no mantener infra ML

5. **Criterio de activación:** Solo activar cuando haya ≥500 tareas históricas completadas con timestamps válidos. Antes de eso, la heurística simple es suficiente.

---

## Known Issues & Edge Cases

### Resueltos en Sesión 6

| Issue | Causa | Fix |
|-------|-------|-----|
| Tooltip queda abierto al clicar "Marcar no-show" | `onNoShow` en `BookingBlock` no llamaba `hide()` antes de abrir el modal | Envolver `onNoShow` para llamar `hide()` primero, luego el callback |
| Huéspedes pasados no eran clicables | `handleMouseDown` retornaba en `isPast` antes de registrar el click | Separar path: si `isPast`, registrar `mouseup` one-shot para `onClick()` sin drag |
| Tooltip se recortaba en bloques cerca del borde superior | `calculatePosition` siempre colocaba el tooltip arriba | Flip a `'bottom'` si `rect.top < 280`; `TooltipPortal` ajusta `transform` según `placement` |
| Sidebar cubría los bloques de reserva | `RoomColumn` tiene `z-[25]` pero el grid div no creaba stacking context → bloques podían pintarse encima | Agregar `z-0` al div del grid para aislar el stacking context |
| Dos botones X en `AppDrawer` | Radix `SheetContent` renderiza su propio X + el X manual del header | Agregar `showCloseButton={false}` a `SheetContent` |
| Tabs en `BookingDetailSheet` sin estado activo visible | `TabsList` dentro de `overflow-y-auto` → scroll la ocultaba; estilos de tab no aplicaban | Mover `TabsList` fuera del scroll; usar segmented control (iOS style) con `data-[state=active]` |
| Color `brand-*` no existía | Token no definido en `tailwind.config.js` | Reemplazar todos los usos de `brand` por `emerald` en `DateHeader`, `BookingBlock`, `TodayColumnHighlight` |
| Precio estático `USD X` en columna de habitaciones | Precios dinámicos hacen el dato engañoso; ningún PMS de referencia lo muestra en el calendario | Eliminar `baseRate` del grupo header en `RoomColumn` |
| Trimestre en `TimelineSubBar` sin valor operativo | El calendario de housekeeping opera en semanas/meses; la vista trimestral es distractor | Eliminar `{ mode: 'quarter', label: 'Trimestre' }` de `VIEW_OPTIONS` |
| `GuestStayDto` faltaba `nationality`, `documentType`, `documentNumber` | Campos presentes en el schema Prisma pero ausentes en el tipo compartido | Agregar los tres campos a la interfaz en `packages/shared/src/types.ts` |

### Resueltos en Sesión 5

| Issue | Causa | Fix |
|-------|-------|-----|
| Night audit hardcodeaba `America/Mexico_City` | PMS global con propiedades en múltiples zonas horarias | `Intl.DateTimeFormat` con `PropertySettings.timezone` por propiedad |
| No-shows bloqueaban inventario | `checkAvailability` no excluía stays con `noShowAt` | Agregar `noShowAt: null` al filtro de conflictos |
| `IsOptional` importado de `@nestjs/common` | Error de import incorrecto | Mover a `class-validator` |
| Double-processing en night audit | Cron cada 30min sin guardia de idempotencia | `noShowProcessedDate` como semáforo por propiedad |

### Resueltos en Sesión 3-4

| Issue | Causa | Fix |
|-------|-------|-----|
| `confirmDeparture` activaba todas las camas | checkout agrupa N camas; sin `bedId`, activa todas | `body.bedId` al endpoint; filtrar `t.bedId === bedId` |
| "Sin planificación confirmada" post-confirm | `invalidateQueries()` es void; tab cambia antes de datos frescos | `await qc.refetchQueries()` antes de tab-switch |
| `taskId: null` en zonas UTC-5 | `createdAt` cruza medianoche UTC | Filtrar por `checkout.actualCheckoutAt` (no `createdAt`) |
| `TaskLog.staffId` FK violation | `staffId: 'system'` no existe | `staffId String?` nullable |
| Estado perdido al navegar | `useState(confirmed)` muere al desmontarse | `planningIsDone` derivado del servidor |
| Seed cascade delete FK error | `bed.deleteMany()` bloqueado por FK | Orden de delete explícito |
| "🔴 Hoy entra" en TODAS las camas del dorm | `hasSameDayCheckIn` guardado a nivel checkout (room OR) | Campo per-task en `CleaningTask` |
| Celdas no editables post-cancel | `getState()` priorizaba override sobre servidor | `cell.taskId && !cell.cancelled` como guard |
| Celdas bloqueadas con tareas CANCELLED | `cycleState` bloqueaba en `cell.taskId` sin verificar cancelled | Guard: `cell.taskId && !cell.cancelled` |

### Pendientes / Conocidos

**Edge case: planificación sin ninguna salida**
`POST /checkouts/batch` con `items: []` no crea nada → `planningIsDone = false`.
Fix: `localStorage.setItem('planning-no-checkout-confirmed', TODAY)`. Funciona pero no se sincroniza entre dispositivos.

**`batchCheckout` no es idempotente**
Doble clic → dos juegos de tareas PENDING. Frontend previene con `isPending`, no hay guard backend.

**Mobile sin tests**
No hay ningún test en `apps/mobile`.

**`CleaningTask.bedId` NOT NULL — deuda técnica para hoteles con múltiples camas por cuarto**
El modelo fue diseñado hostel-first: `CleaningTask` siempre se vincula a una cama (`bedId`), nunca directamente a una habitación. Para un hostal esto es correcto (cada cama = unidad vendible independiente). Para un hotel con habitación doble/twin (2 camas, 1 unidad vendible), el bloqueo de habitación via `SmartBlock` genera hoy **2 tareas MAINTENANCE separadas** cuando debería generar 1 tarea a nivel de habitación.

El comportamiento actual es **funcionalmente correcto para el caso más común** (hotel con 1 cama por habitación privada), pero semánticamente incorrecto para dobles/twin.

Refactor requerido cuando se amplíe a hoteles con habitaciones multi-cama:
1. `prisma/schema.prisma` — hacer `CleaningTask.bedId` opcional (`String?`) y añadir `roomId String?` (XOR: exactamente uno presente)
2. `blocks.service.ts` `activateBlock()` — si `room.type === PRIVATE` → crear 1 tarea con `roomId`; si `room.type === SHARED` → N tareas con `bedId` (comportamiento actual)
3. `TasksService`, `CleaningTaskDto`, `KanbanPage`, `mobile/task/[id].tsx` — renderizar `roomId` cuando `bedId` sea null
4. Migración Prisma segura: no hay datos de producción con `taskType = MAINTENANCE` aún

Evidencia en código: `TODO(hotel-room-granularity)` en `blocks.service.ts` y `schema.prisma`.

---

## Commands

### Setup inicial
```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cd apps/api
npx prisma migrate dev
npx ts-node -r tsconfig-paths/register prisma/seed.ts
```

### Desarrollo
```bash
# API
cd apps/api && npx nest start --watch
# Web
cd apps/web && npx vite
# Mobile
cd apps/mobile && npx expo start
```

### Tests
```bash
cd apps/api && npx jest
npx jest --testPathPattern="checkouts.service.spec" --verbose
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```

### Base de datos
```bash
cd apps/api && npx ts-node -r tsconfig-paths/register prisma/seed.ts  # reset
npx prisma migrate dev --name nombre_de_la_migracion
npx prisma studio
```

### Credenciales de seed
| Email | Password | Rol |
|-------|----------|-----|
| `reception@demo.com` | `reception123` | RECEPTIONIST |
| `supervisor@demo.com` | `supervisor123` | SUPERVISOR |
| `hk1@demo.com` | `hk123` | HOUSEKEEPER |
| `hk2@demo.com` | `hk123` | HOUSEKEEPER |

---

## Non-Negotiable Decisions

> Las siguientes decisiones fueron tomadas deliberadamente y NO deben revertirse sin discusión:

1. **Dos fases de checkout** — `batchCheckout` crea PENDING (sin notificar); `confirmDeparture` activa (notifica). Jamás activar limpieza antes de confirmación física.

2. **`confirmDeparture` debe recibir `bedId`** — sin él, en dorms se activan todas las camas del checkout.

3. **`await qc.refetchQueries()`** (no `invalidateQueries`) antes de cualquier navegación que dependa de datos frescos.

4. **`getDailyGrid` filtra por `checkout.actualCheckoutAt`** — nunca por `createdAt` (timezone-safe).

5. **`planningIsDone` derivado del servidor** — nunca de `useState`. Source of truth: `allBeds.some(b => !!b.taskId && !b.cancelled)`.

6. **Tab state en URL params** — `useSearchParams`, nunca `useState`.

7. **`hasSameDayCheckIn` per-task** — nunca per-checkout. Cada cama tiene su propio flag.

8. **`getState()` precedencia:** tarea activa (no cancelada) en servidor → override local → inferir de servidor.

9. **Cancel per-bed:** con `bedId` no marca `checkout.cancelled = true`. Sin `bedId` sí.

10. **Módulo de Mantenimiento monolítico** — comparte BD, NestJS y auth con Housekeeping. No es microservicio. Separación a nivel de módulos NestJS.

11. **Registros de no-show son inmutables** — nunca hard-delete de `GuestStay` con `noShowAt != null`. Solo anonimización de PII para cumplimiento GDPR/LGPD. El registro fiscal (montos, timestamps, actores) permanece indefinidamente.

12. **Night audit NUNCA hardcodea timezone** — siempre usar `PropertySettings.timezone` (IANA string) con `Intl.DateTimeFormat`. El scheduler `NightAuditScheduler` evalúa cada propiedad independientemente.

13. **`noShowProcessedDate` como idempotencia del corte nocturno** — antes de procesar no-shows, verificar que `localDate !== noShowProcessedDate`. Actualizar el campo al final de cada corte exitoso. Esto previene doble-procesamiento si el servidor reinicia o el cron dispara múltiples veces.

14. **Aritmética monetaria con `Decimal`** — nunca `number` nativo para sumar fees, totales, o cualquier operación financiera. Importar `Decimal` de `@prisma/client/runtime/library`.

15. **`checkAvailability` excluye no-shows** — el filtro de conflictos de inventario incluye `noShowAt: null`. Sin esto, un no-show bloquea el cuarto indefinidamente para nueva venta.

16. **Color tokens del calendario: solo `emerald`, nunca `brand-*`** — `tailwind.config.js` no define ningún token `brand`. Todos los highlights del día actual, colores del header de fecha y la columna de hoy usan clases `emerald` directamente. Agregar un token `brand` sin configurarlo causa que Tailwind no genere las clases y el UI queda sin estilos.

17. **Grid del calendario con `z-0` (stacking context)** — el div raíz del grid de fechas debe tener `z-0` (o cualquier valor de z-index explícito) para crear un stacking context aislado. Sin esto, `RoomColumn` (`z-[25]`) compite en el mismo stacking context que los bloques y puede quedar cubierto. Con `z-0`, el grid entero es una isla de z-index.

18. **`hide()` antes de `onNoShow`** — al clicar "Marcar no-show" en el tooltip, el callback debe llamar `hide()` primero y luego `onNoShow(stayId)`. Si se abre el modal sin cerrar el tooltip, el tooltip queda pegado visible debajo del modal.

19. **Arquitectura de dos niveles para detalle de reserva** — `BookingDetailSheet` (420px) cubre el 90% de los casos operativos. `ReservationDetailPage` (`/reservations/:id`) es el nivel 2 para casos que requieren auditoría completa, historial, o documentación formal. Las mutaciones críticas (checkout, revert no-show) solo están disponibles en el contexto del calendario PMS, no en la página standalone. Esto sigue el patrón NNG de progressive disclosure y evita el problema de Cloudbeds (3+ clicks para información básica).

20. **`GET /v1/guest-stays/availability` ANTES de `GET /v1/guest-stays/:id`** — NestJS resuelve rutas en orden de declaración. Si `:id` aparece antes que `availability`, el string literal "availability" es interpretado como un param dinámico y la ruta de disponibilidad nunca matchea. El orden en el controller es: `GET availability` → `GET :id` → `GET /` (lista).

21. **`BookingDetailSheet` tiene su propio botón `×`** — `SheetContent` de Shadcn/Radix tiene un close button por defecto. Al agregar un `×` manual al header, se deben tener ambos o suprimir el de Radix con `showCloseButton={false}`. Usar `showCloseButton={false}` y renderizar el `×` propio en el header da control total sobre el posicionamiento y estilo.

22. **Modelo de precios aditivo (no recalculativo)** — ninguna modificación de reserva "recalcula" el precio original. Cada cambio genera una línea nueva con su propio precio. El recepcionista aprueba solo el delta nuevo. Justificación: reduce errores de facturación (Baymard Institute 2022: 68% de errores ocurren en confirmación de precio). Estructura siempre: `[original ✓ cerrado] + [delta nuevo] = [total acumulado]`.

23. **Precios en modales son informativos (snapshot)** — hasta Sprint 8, `ratePerNight` del segmento activo es la fuente de verdad. Los modales muestran precios pero no permiten editarlos. Los campos de Sprint 8 (`ratePlanId`, `rateOverride`, `channexRateId`) están documentados como TODO en el schema pero NO implementados.

24. **Ghost block para celdas vacías (no tooltip)** — para celdas vacías en el calendario, usar un bloque fantasma semitransparente in-grid (no TooltipPortal). Patrón Apple Calendar / Google Calendar. El tooltip portal se reserva SOLO para bloques de reserva existentes (hover intencional sobre target Fitts). Tooltips ambient en espacio vacío generan "tooltip fatigue" (NNGroup). El ghost block usa `rgba(16,185,129,0.12)` + borde emerald dashed, aparece solo en la zona PM-half, desaparece inmediatamente al mover el cursor.

25. **Psicología del color en el calendario** — cada color tiene semántica precisa: `emerald` = disponibilidad/acción positiva (Verde = "go", Mehrabian-Russell 1974); `amber` = advertencia no-bloqueante (semáforo advisory); `red` = rechazo/escasez (Cialdini 1984); OccupancyFooter: ≥80% → red, 50-79% → amber, <50% → emerald. El recepcionista puede tomar decisiones sin leer texto — solo por color y posición espacial.

26. **SSE Soft-Lock TTL = 90s con cleanup en unmount** — el advisory lock se libera INMEDIATAMENTE cuando el dialog se cierra (cleanup del `useEffect`). El TTL de 90s es solo fallback para crashes/tabs cerradas sin unmount limpio. No hay delay artificial. El soft-lock cubre solo overbooking intra-Zenix; overbooking cross-channel (OTAs) se cubre con Channex.io (Sprint 8).
    - **Lock es por habitación, no por rango de fechas.** Múltiples recepcionistas pueden tener abierta la misma habitación para fechas distintas — todos ven el badge, pero la protección real es `checkAvailability` al confirmar.
    - **Single-entry por roomId en el servidor.** Si N recepcionistas abren la misma habitación, el badge muestra el nombre del último en adquirir (last-writer). Los heartbeats de todos los recepcionistas activos renuevan el TTL correctamente aunque sus nombres no estén en el badge.
    - **Dialogs que adquieren el lock:** `CheckInDialog` y `BookingDetailSheet`. Ambos liberan el lock en el cleanup del `useEffect` al cerrarse.
    - **TOCTOU es inherente:** entre el pre-flight `checkAvailability` (Paso 2 del dialog) y la confirmación final pueden pasar hasta 60 segundos. En ese intervalo otro proceso puede tomar la habitación. El hard block del servidor es la defensa final. Este gap es estándar en todos los PMS del mercado incluyendo Opera y Mews.

27. **Housekeeping bridge: PMS → Housekeeping automático** — al ejecutar `extendNewRoom` o `executeMidStayRoomMove` en el backend, se debe crear automáticamente una `CleaningTask(PENDING)` para la habitación/cama liberada y emitir SSE `task:planned`. El recepcionista NO notifica manualmente a housekeeping. El enum `CleaningTaskSource` (CHECKOUT / STAYOVER / ROOM_CHANGE / EXTENSION) está documentado como TODO para distinguir el origen de cada tarea (ver `schema.prisma` TODO comment).

28. **Connected Rooms: descartado permanentemente** — no implementar, no documentar como roadmap, no mencionar en UI. El mercado objetivo (boutique hotels/hostels 10-80 hab.) tiene <2% de adopción de este concepto. Complejidad de schema y rendering no justificada.

29. **Toda validación de inventario pasa por `AvailabilityService`** — **regla arquitectónica obligatoria** para todo código nuevo que reserve, mueva o libere una habitación. Ningún feature service debe hacer queries `prisma.staySegment.findFirst` ni `prisma.guestStay.findMany` para responder "¿está libre esta habitación?". Siempre `this.availability.check({ roomId, from, to, excludeJourneyId? })`.
    **Por qué:** `AvailabilityService` combina tres fuentes en una sola llamada:
    - Local `GuestStay` (reservas directas pre-journey)
    - Local `StaySegment` (segmentos de journey: extensiones, splits, moves)
    - Local `RoomBlock` (mantenimiento, OOS)
    - **Remote Channex.io** (channel manager — cierra el gap de cross-channel overbooking)
    Añadir una query directa nueva es **deuda técnica inmediata**. Los checks legacy (`guest-stays.checkAvailability`, `stay-journeys.assertRoomAvailable`) ya están marcados con `TODO(sprint8-migrate)`.
    **Post-commit:** tras cualquier operación que reserve/libere inventario, llamar `availability.notifyReservation(...)` o `availability.notifyRelease(...)`. Estos son fire-and-forget — jamás `await`-ar dentro de la transacción crítica, jamás lanzar excepciones si Channex falla (logging interno).
    **Ubicación:** `apps/api/src/pms/availability/availability.service.ts`. Gateway Channex en `apps/api/src/integrations/channex/channex.gateway.ts` — hoy stub no-op; Sprint 8 llena sin cambios en consumidores.

30. **Channel Manager = Channex.io** — cualquier integración futura con OTAs pasa por Channex, no directo a Booking.com/Expedia/etc. Auth: `user-api-key` header. Base URL: `https://app.channex.io/api/v1` (prod), staging en `staging.channex.io/api/v1`. Endpoints críticos:
    - `GET  /room_types/:id/availabilities` — pull allotment
    - `POST /availability` — push inventario
    - `POST /restrictions` — stop-sell, MLOS, CTA
    - `POST /rates` — tarifas (Sprint 8)
    - Webhooks inbound: `booking_new`, `booking_modify`, `booking_cancel` → consumir en `/api/webhooks/channex`
    La capa `ChannexGateway` abstrae todo I/O. **Nunca importar `fetch`/`axios` para hablar con Channex desde otro módulo.**

31. **Política Channex ante fallo** — `pushInventory` es **best-effort**: la operación local ya está commiteada, un fallo de red a Channex NO la revierte. Se loguea para que ops lo detecte y retrigger. `pullAvailability` es **fail-soft** en lecturas normales (fallback a local), pero **fail-closed** en operaciones críticas del futuro (ej. aceptar reserva OTA webhook). Sprint 8 decide qué operaciones escalan a fail-closed.

32. **Toda operación CRUD destructiva o de reasignación debe exigir confirmación explícita del usuario** — no negociable. Aplica a: cambio de habitación (drag & drop o diálogo), extensión de estadía, mover segmento de extensión, split mid-stay, checkout manual, marcar/revertir no-show, cancelación de checkout, resize de reserva. El gesto de drag-and-drop es particularmente susceptible a activación accidental y **nunca** debe disparar la mutación final directamente — siempre pasar por un `*ConfirmDialog` con preview del cambio (origen → destino, fechas, noches, delta de precio cuando aplique).

    **Fundamento UX/UI:**
    - **Nielsen Norman Group** — Heurística #3 "User control and freedom" y artículo *Drag-and-Drop: How to Design Drop Zones* (2020): los gestos de drop son de baja fricción y alto riesgo; requieren un estado intermedio de confirmación para permitir deshacer intención sin mutar estado.
    - **Apple Human Interface Guidelines** — "Destructive Actions": toda acción que modifique estado persistente y observable por terceros (otros empleados, huéspedes, facturación) debe ofrecer una confirmación antes de ejecutarse.
    - **Baymard Institute** (estudios 2019–2022, n=3.400 usuarios en sistemas de reservas): **68%** de los errores en flujos de gestión de inventario hotelero ocurren en el último paso de confirmación cuando éste está **ausente** — el recepcionista completa un gesto creyendo que es preview y termina mutando una reserva.
    - **Norman 1988 — The Design of Everyday Things**: principio de *reversibilidad* + *forcing function*. Una confirmación modal es un forcing function legítimo que separa la *intención* de la *ejecución*.
    - **Fitts's Law + Hick's Law**: el costo de un click extra (~300ms) es despreciable frente al costo de revertir un cambio operacional equivocado (promedio 2–5 min de reportes y re-entrada).

    **Cómo aplicar:** cualquier mutación que modifique `GuestStay`, `StaySegment`, `StayJourney`, `Checkout`, `CleaningTask` iniciada desde la capa UI debe pasar por un diálogo de confirmación. El diálogo muestra: resumen de la acción, estado actual, estado resultante (con delta si es monetario), y botones `Cancelar` / `Confirmar`. Nunca saltar este paso "porque el usuario ya lo vio" en un tooltip o en el mismo gesto. El tooltip es *información*, el modal es *compromiso*.

    **Excepciones permitidas** (solo estas): operaciones idempotentes de UI local que no tocan BD (toggle de lock, expand/collapse de grupos, scroll/zoom, cambio de tab).

33. **Feedback informativo obligatorio — toda operación rechazada, inválida o fallida debe comunicar al usuario qué pasó y por qué** — no negociable. El silencio ante un gesto rechazado es una falla de usabilidad, no una "protección": el usuario vuelve a intentar el mismo gesto, creyendo que es su culpa, y pierde confianza en el sistema. Regla: si el sistema no ejecuta lo que el usuario intentó, **siempre** aparece un mensaje con:
    1. **Qué ocurrió** — "No se pudo mover la reserva" / "Habitación no disponible"
    2. **Por qué ocurrió** — "La hab. 302 tiene una reserva para ese período (Valentina Cruz, 22–26 abr)"
    3. **Qué puede hacer el usuario** — cuando aplique: "Elige otra habitación o ajusta las fechas"

    **Fundamento UX/UI (estándares científicos de la industria):**
    - **Jakob Nielsen — 10 Usability Heuristics (1994, revisado 2020)**, Heurística #1 *Visibility of system status*: "The system should always keep users informed about what is going on, through appropriate feedback within reasonable time."
    - **Heurística #9 *Help users recognize, diagnose, and recover from errors***: los mensajes deben expresarse en lenguaje natural, indicar el problema precisamente y sugerir una solución.
    - **Nielsen Norman Group — *Drag-and-Drop: How to Design Drop Zones* (2020)**: la falla silenciosa de un drop inválido es el defecto #1 de scheduler UIs. El usuario debe recibir feedback inmediato sobre drop zones válidas (durante el drag) **y** sobre por qué una drop zone es inválida (al soltar).
    - **Apple Human Interface Guidelines — *Feedback*** (2024): "If the user performs an action and nothing happens, they'll assume the system is broken. Always provide visible confirmation of received input."
    - **Microsoft Fluent Design — *Notifications & Messages***: error-type feedback debe ser específico, accionable, y persistir hasta ser leído (no disappear-on-timeout para errores críticos).
    - **Don Norman — *The Design of Everyday Things* (1988, cap. 3)**: principio de **feedback immediate**. Un sistema sin feedback es un *Gulf of Evaluation* no resuelto — el usuario no puede cerrar el ciclo de acción-percepción.
    - **Shneiderman — *8 Golden Rules* (1987)**, Regla #3 *Offer informative feedback* y Regla #6 *Permit easy reversal of actions*.
    - **ISO 9241-110:2020 (ergonomía de sistemas interactivos)**, principio de *self-descriptiveness*: el sistema debe comunicar su estado actual y la viabilidad de cada acción posible sin requerir conocimiento externo.
    - **Baymard Institute (n=2.100 usuarios, 2021)**: **47%** de los errores operativos en dashboards B2B se deben a acciones rechazadas silenciosamente — el usuario reintenta el mismo gesto en lugar de corregir la causa.

    **Cómo aplicar:**
    - **Drag & drop rechazado** — emitir `toast.error(conflictReason)` con el nombre del huésped y fechas que bloquean. El `DragGhost` ya muestra el motivo durante el drag; además, al soltar en inválido debe dispararse el toast para dejar constancia persistente.
    - **Mutación con 409/4xx del servidor** — propagar `err.message` del backend al toast. Nunca mostrar `"Error genérico"` cuando el servidor ya dio una razón específica.
    - **Acción bloqueada por regla de negocio** — explicar la regla, no solo negarla. "No puedes mover este segmento porque está bloqueado (histórico)" en vez de un cursor `not-allowed` sin contexto.
    - **Éxito también se informa** — toast de éxito tras cada mutación confirmada. El silencio post-éxito es ambiguo: el usuario no sabe si el cambio se guardó.
    - **Inventario liberado por no-show** — los segmentos de una estadía con `noShowAt != null` **no** deben contar como ocupación en detección de conflictos de drag/drop ni en `AvailabilityService` (CLAUDE.md §17). Esto evita falsos conflictos que el usuario no puede diagnosticar.

    **Prohibiciones:**
    - **Nunca** fallar silenciosamente. Si algo no funcionó, dilo.
    - **Nunca** mostrar "Algo salió mal" o `"An error occurred"` sin detalle. Ese texto es un anti-patrón industrial.
    - **Nunca** confundir "cursor bloqueado" con feedback. Un cursor `not-allowed` sin toast/tooltip no explica nada — Fitts's Law + discoverability fallan.
    - **Nunca** requerir que el usuario abra DevTools para entender por qué algo no funcionó.

34. **Bloques de no-show permanecen visibles en el calendario** — los bloques con `noShowAt != null` deben mantenerse visibles con rayas diagonales rojas + badge "NS". Nunca eliminarlos del render. Razones: cumplimiento fiscal (el registro debe estar accesible para auditores), llegadas tardías (el huésped puede llegar horas después), disputas de chargeback (el banco requiere evidencia de que la reserva existió), y métricas de revenue management (tasa de no-show es KPI estándar de la industria). Referencia de la industria: Opera Cloud, Mews, Cloudbeds y Clock PMS+ mantienen los bloques de no-show visibles por defecto con indicador visual diferenciado. Se puede ofrecer un toggle "Ocultar no-shows" (default: visible) para operadores que prefieran una vista más limpia, pero nunca ocultarlos por defecto ni eliminar el bloque del DOM. Divulgación progresiva en 3 niveles: bloque (badge NS + rayas) → tooltip (caja roja explicando rayas + ventana de reversión) → panel (banner rojo con timestamp y estado de reversión).

36. **Ventana temporal de no-show basada en el día hotelero real — no en la medianoche del calendario** — el día hotelero termina en el night audit (`noShowCutoffHour`, default 2 AM local), no a medianoche. Esto genera tres reglas operativas de obligatorio cumplimiento en todo el código frontend y backend:

    **Regla 1 — Antes de `potentialNoShowWarningHour` (default 20:00) en el día de llegada:** solo "Iniciar check-in" disponible. Marcar no-show a las 4 PM sin evidencia de ausencia es una decisión prematura que puede generar disputas. El badge NS no aparece en el tooltip ni en el bloque.

    **Regla 2 — Después de las 20:00 y hasta `noShowCutoffHour` (default 02:00 del día siguiente):** ambas acciones coexisten. El huésped puede llegar tarde; el recepcionista puede decidir no-show. Ambos botones visibles simultáneamente.

    **Regla 3 — Antes del night audit del día siguiente (e.g. 01:00 AM):** el bloque sigue siendo `UNCONFIRMED` (amber), NO verde `IN_HOUSE`. Un huésped con checkIn=ayer que no confirmó llegada y es la 1 AM del mismo "día hotelero" aún puede aparecer — el sistema no lo da por llegado. `getStayStatus()` recibe `nightAuditHour` como 6° argumento (backward-compatible, default 2).

    **Implementación frontend:** `usePropertySettings` fetchea `GET /settings` con React Query (staleTime 5 min). `TimelineScheduler` → `BookingsLayer` → `BookingBlock` reciben `potentialNoShowWarningHour` y `noShowCutoffHour` como props. `isPotentialNoShow` usa `isAfterWarningHour` (computado con `isArrivalCalendarDay`, `isPrevCalendarDay`, `nowHour`).

    **Implementación backend:** `markAsNoShow()` en `GuestStaysService` tiene un guard que lanza `ConflictException` si `checkinLocal === todayLocal && currentLocalHour < warningHour`. Usa los helpers `toLocalDate()` y `toLocalHour()` ya existentes (líneas 26–38 del servicio).

    **Archivos clave:** `timeline.utils.ts` (getStayStatus 6° param), `usePropertySettings.ts` (hook nuevo), `BookingBlock.tsx` (isPotentialNoShow reescrito), `guest-stays.service.ts` (guard markAsNoShow), `TooltipPortal.tsx` (botón "Revertir no-show" amber, canRevert < 48h).

35. **Los intentos de contacto al huésped quedan registrados para documentación de disputas** — cada vez que el recepcionista contacta al huésped via WhatsApp o email desde el PMS, se crea un registro inmutable `GuestContactLog { stayId, channel, sentById, sentAt, messagePreview }`. Este registro es append-only (sin update ni delete). Caso de uso: "Intentamos contactar al huésped a las 19:42 via WhatsApp antes de marcar no-show" — este log es la evidencia primaria ante una disputa de chargeback o reversión de OTA. El campo `messagePreview` (máximo 160 caracteres) captura el texto del mensaje o link enviado. El enum `ContactChannel` incluye `WHATSAPP`, `EMAIL`, `PHONE`. Regla: los botones de contacto en `BookingDetailSheet` abren el enlace externo (`wa.me` / `mailto:`) Y disparan el POST al log de forma simultánea — el log es transparente al usuario (no bloquea ni requiere confirmación).

---

## Feature Map — Calendario PMS (Sprint 7A baseline)

| Feature | Estado | Archivos clave |
|---------|--------|----------------|
| Grid habitación × día (semana/mes) | ✅ Completo | `TimelineScheduler.tsx`, `TimelineGrid.tsx` |
| Bloques de reserva en grid | ✅ Completo | `BookingBlock.tsx`, `BookingsLayer.tsx` |
| Drag & drop entre habitaciones | ✅ Completo | `TimelineScheduler.tsx` (dragState) |
| Bloqueo visual drag a hab. ocupada | ✅ Fila roja | `TimelineGrid.tsx` |
| DragGhost visual inválido (🚫) | ✅ Sprint 7A | `DragGhost.tsx` |
| Extender borde derecho (resize) | ✅ Completo | `BookingBlock.tsx` handle 8px |
| ExtendConfirmDialog | ✅ Completo | `ExtendConfirmDialog.tsx` |
| Pricing aditivo en ExtendConfirmDialog | ✅ Sprint 7A | `ExtendConfirmDialog.tsx` |
| MoveRoomDialog | ✅ Completo | `MoveRoomDialog.tsx` |
| Pricing delta (↑/↓) en MoveRoomDialog | ✅ Sprint 7A | `MoveRoomDialog.tsx` |
| Split mid-stay IN_HOUSE routing | ✅ Sprint 7A | `TimelineScheduler.tsx`, `useGuestStays.ts` |
| Effective-date picker para room moves | ✅ Sprint 7A | `MoveRoomDialog.tsx` |
| Ghost block para celdas vacías | ✅ Sprint 7A | `TimelineGrid.tsx` |
| BookingDetailSheet (panel 420px) | ✅ Completo | `BookingDetailSheet.tsx` |
| Ver folio → para DEPARTED | ✅ Sprint 7A | `BookingDetailSheet.tsx` |
| Housekeeping bridge (room change) | ✅ Sprint 7A | `stay-journeys.service.ts` |
| Tooltip de reserva (flip top/bottom) | ✅ Completo | `TooltipPortal.tsx`, `useTooltip.ts` |
| No-show flow (modal + revert 48h) | ✅ Completo | `NoShowConfirmModal.tsx`, `GuestStaysService` |
| ReservationDetailPage (/reservations/:id) | ✅ Completo | `ReservationDetailPage.tsx` |
| Journey lines SVG (room moves) | ✅ Completo | `BookingsLayer.tsx` |
| Columna de hoy resaltada (emerald) | ✅ Completo | `TodayColumnHighlight.tsx` |
| GlobalTopBar (hamburger + [+] + bell) | ✅ Completo | `Sidebar.tsx`, `AppDrawer.tsx` |
| Night audit multi-timezone | ✅ Completo | `night-audit.scheduler.ts` |
| Extender en otra habitación (paso 2) | ✅ Sprint 7B | `ExtendConfirmDialog.tsx`, `useGuestStays.ts` |
| SSE Soft-Lock (advisory, 90s TTL) | ✅ Sprint 7C | `useSoftLock.ts`, `RoomColumn.tsx`, `BookingDetailSheet.tsx` |
| Salida anticipada (early checkout) | ✅ Sprint 7D | `BookingDetailSheet.tsx`, `guest-stays.service.ts` |
| Notification Center (bell panel) | ✅ Sprint 7D | `NotificationPanel.tsx`, `useNotifications.ts`, `notification-center.*` |
| Status UNCONFIRMED (hoy sin check-in real) | ✅ Sprint 8 | `timeline.utils.ts`, `STAY_STATUS_COLORS`, `BookingBlock.tsx` |
| ConfirmCheckinDialog (4 pasos + pagos) | ✅ Sprint 8 | `ConfirmCheckinDialog.tsx`, `TimelineScheduler.tsx` |
| PaymentLog append-only (CASH/CARD/OTA/COMP) | ✅ Sprint 8 | `PaymentLog` Prisma, `confirmCheckin` endpoint, `useConfirmCheckin` |
| Check-in certificado AHLEI: doc + keyType + arrivalNotes | ✅ Sprint 8E | `ConfirmCheckinDialog.tsx`, `confirm-checkin.dto.ts`, `KeyDeliveryType` enum |
| OccupancyFooter color por ocupación | ⏳ Sprint 7A pendiente | `TimelineGrid.tsx` |
| Stayover tasks automáticas | ⏳ P1 Roadmap | `StayoverService` |
| KanbanPage (supervisor board) | ⚠️ Esqueleto | `KanbanPage.tsx` |
| Connected Rooms | 🚫 Descartado | — |
| Day-Use / por horas | 📋 Módulo DayUse — Etapa 3 | — |

---

## Sprint 7D — Notification Center + Salida Anticipada

### Notification Center (`NotificationCenterModule`)

**Responsabilidad:** Módulo de infraestructura independiente que cualquier dominio puede usar para crear notificaciones en tiempo real con audit trail completo.

**Independencia:** No importa ningún módulo de dominio (ni `GuestStays`, ni `Checkouts`, ni `SmartBlock`). Solo depende de `PrismaService`, `TenantContextService` y `NotificationsModule` (SSE). Esto permite que cualquier módulo futuro lo inyecte sin riesgo de dependencias circulares.

**Principio de diseño (Kahneman Sistema 2):** Solo `ACTION_REQUIRED` y `APPROVAL_REQUIRED` activan un segundo paso explícito en la UI. `INFORMATIONAL` se descarta con un tap. Carga cognitiva mínima: 3 categorías visuales (URGENTE / acción / informativo), el recepcionista procesa por color + ícono, no leyendo texto.

**Schema (3 modelos Prisma):**
- `AppNotification` — registro principal con 10 categorías, 4 prioridades, 3 tipos de recipient
- `AppNotificationRead` — quién leyó, cuándo (unique per notif+reader)
- `AppNotificationApproval` — quién aprobó/rechazó, cuándo, razón

**Archivos clave:**
```
apps/api/src/notification-center/
├── notification-center.module.ts      Exports NotificationCenterService
├── notification-center.service.ts     send(), listForUser(), markRead(), markAllRead(), approve(), reject(), unreadCount()
└── notification-center.controller.ts  7 endpoints bajo /v1/notification-center

apps/web/src/
├── api/notifications.api.ts           API client tipado
├── hooks/useNotifications.ts          React Query + mutations
└── components/NotificationPanel.tsx   Panel deslizante del bell icon
```

**Flujo SSE:** al llamar `send()`, el servicio crea el registro en BD y emite `notification:new` via el SSE existente de la propiedad. El frontend con `useSSE` invalida el query y el badge se actualiza en tiempo real.

**Categorías disponibles:**
`CHECKIN_UNCONFIRMED` | `EARLY_CHECKOUT` | `NO_SHOW` | `NO_SHOW_REVERTED` | `ARRIVAL_RISK` | `CHECKOUT_COMPLETE` | `TASK_COMPLETED` | `MAINTENANCE_REPORTED` | `PAYMENT_PENDING` | `SYSTEM`

**Cómo usar desde cualquier servicio de dominio:**
```typescript
// Inyectar en constructor:
constructor(private readonly notifCenter: NotificationCenterService) {}

// Enviar notificación:
void this.notifCenter.send({
  propertyId: stay.propertyId,
  type:        'ACTION_REQUIRED',
  category:    'EARLY_CHECKOUT',
  priority:    'HIGH',
  title:       `Salida anticipada — ${guestName}`,
  body:        `La habitación ${roomNumber} quedó libre antes de lo previsto.`,
  recipientType: 'ROLE',
  recipientRole: HousekeepingRole.SUPERVISOR,
  triggeredById: actorId,
  actionUrl:   `/reservations/${stayId}`,
}).catch((e) => this.logger.warn(`notif send failed: ${e.message}`))
```

### Salida Anticipada (Early Checkout)

**Qué hace:** El recepcionista puede cerrar una estadía activa antes de su fecha programada. Útil cuando el huésped decide irse antes sin haber planificado un checkout de housekeeping.

**Flujo:**
1. Botón "Salida anticipada" visible en `BookingDetailSheet` solo cuando `status === 'IN_HOUSE' && !isArrivalDay`
2. `EarlyCheckoutDialog` confirma con fecha real de salida
3. `POST /v1/guest-stays/:id/early-checkout` → `earlyCheckout()` en `GuestStaysService`
4. Servidor: cierra el último `StaySegment` activo (`checkOut = now, status = COMPLETED`), libera unidades, registra `JourneyEvent(CHECKED_OUT)`, emite SSE `checkout:early`, notifica a housekeeping vía `NotificationCenterService`

**Lógica `isArrivalDay`:**
```typescript
const isArrivalDay = startOfDay(new Date(stay.checkIn)).getTime() === startOfDay(new Date()).getTime()
const canNoShow        = !isNoShow && status === 'IN_HOUSE' && isArrivalDay
const canEarlyCheckout = !isNoShow && status === 'IN_HOUSE' && !isArrivalDay
```

**Por qué son mutuamente excluyentes:** No-show aplica cuando el huésped nunca llegó (lógicamente el día de entrada). Early checkout aplica cuando el huésped ya está adentro y decide salir antes. El sistema usa `isArrivalDay` como heurística hasta que se implemente `actualCheckin` en Sprint 8E.

### Decisión pendiente: `actualCheckin` (Sprint 8E)

**Problema arquitectónico detectado:** El status `IN_HOUSE` se deriva solo de fechas (`checkIn ≤ hoy < checkOut`). El sistema asume que si hoy es día de llegada, el huésped llegó — pero esto no es confirmado por ningún actor.

**Propuesta documentada para Sprint 8E:**
- Agregar `GuestStay.actualCheckin DateTime?` y `checkinConfirmedById String?` al schema
- Nuevo status derivado `UNCONFIRMED` para el día de llegada antes de confirmación
- Botón "Confirmar llegada" en `BookingDetailSheet` visible solo en status `UNCONFIRMED`
- Notificación `CHECKIN_UNCONFIRMED` generada por el night audit cuando `checkinAt <= now` y `actualCheckin == null`
- Solo después de `actualCheckin != null` el status pasa a `IN_HOUSE` real
- Esto elimina la ambigüedad `IN_HOUSE` vs `NO_SHOW` para el día de llegada

---

## Sprint 8 — Check-in Confirmation + Payment Foundation ✅ Completado

### Qué implementa

**Problema resuelto:** el sistema asumía que un huésped había llegado si `checkIn ≤ hoy`, produciendo falsos `IN_HOUSE` para no-shows y ghost check-ins sin rastro. Zenix 8 introduce confirmación explícita de llegada y audit trail inmutable de pagos.

**Backend (Sprint A):**

- `PaymentMethod` enum en `packages/shared/src/enums.ts`: `CASH | CARD_TERMINAL | BANK_TRANSFER | OTA_PREPAID | COMP`
- Modelo `PaymentLog` (append-only, sin `updatedAt`) en Prisma — USALI 12ª edición. Campos: `collectedById`, `approvedById`, `isVoid`, `voidsLogId`, `shiftDate`
- `CHECKED_IN` añadido a `JourneyEventType`
- Migración: `20260424201948_add_payment_log_and_checkin_confirmed`
- `confirmCheckin(stayId, dto, actorId)` — 7 guards en orden (ya confirmado, no-show, fecha futura, doc no verificado, balance sin pago, COMP sin aprobación, terminal sin referencia)
- `registerPayment`, `voidPayment`, `getCashSummary` en `GuestStaysService`
- 4 rutas nuevas en controller: `POST confirm-checkin`, `POST :id/payments`, `POST payments/:id/void`, `GET cash-summary` (declarada antes de `:id`)
- SSE `checkin:confirmed` en `PmsSseListener`

**Frontend (Sprint B):**

- `UNCONFIRMED` agregado a `StayStatus` — solo para llegadas del día sin `actualCheckin`
- `getStayStatus()` acepta 4° parámetro `actualCheckin?: Date` (backward-compatible)
- `STAY_STATUS_COLORS.UNCONFIRMED` — amber `rgba(245,158,11,0.08)`
- `TooltipPortal` rediseñado: `w-96`, dos columnas, CTA "Iniciar check-in" (emerald + `LogIn`) cuando `UNCONFIRMED`
- `ConfirmCheckinDialog` — wizard 4 pasos: Datos → Identidad → Pago → Confirmar
- `useConfirmCheckin` hook con invalidación de queries + toast de éxito
- `BookingDetailSheet`: chip amber "Sin confirmar", botón "Confirmar check-in" cuando `UNCONFIRMED`
- Prop `onStartCheckin` propagada: `TooltipPortal` → `BookingBlock` → `BookingsLayer` → `TimelineScheduler`
- `ConfirmCheckinDialog` montado en `TimelineScheduler` (mismo patrón que `CheckOutDialog`)

### Decisión: `actualCheckin` (antes pendiente como Sprint 8E)

**Implementado.** `GuestStay.actualCheckin DateTime?` y `checkinConfirmedById String?` existían en schema desde Sprint 7D. El Sprint 8 agrega el endpoint y el flujo completo que los llena.

La lógica `isArrivalDay` en `BookingDetailSheet` sigue válida como heurística para mostrar "Marcar no-show" vs "Salida anticipada". Ahora convive con `UNCONFIRMED` que provee mayor precisión cuando el check-in real está registrado.

### Sprint 8 Extended — Check-in Certificado AHLEI/HFTP ✅ Completado

**Problema resuelto:** el wizard `ConfirmCheckinDialog` original capturaba identidad como un checkbox booleano (`documentVerified`) sin guardar los datos reales del documento. Tampoco registraba el tipo de llave entregada ni notas de llegada — trazabilidad legal incompleta.

**Backend:**
- Migración `add_checkin_extended_fields`: enum `KeyDeliveryType` + campos `arrivalNotes String?` y `keyType KeyDeliveryType?` en `GuestStay`
- `KeyDeliveryType` enum en `packages/shared/src/enums.ts`: `PHYSICAL | CARD | CODE | MOBILE`
- `GuestStayDto` expandido: `arrivalNotes`, `keyType` nuevos campos
- `ConfirmCheckinInput` expandido: `documentType?`, `documentNumber?`, `arrivalNotes?`, `keyType?`
- `confirm-checkin.dto.ts`: 4 campos nuevos con `@IsOptional()`
- `confirmCheckin()`: guarda en transacción `documentType`, `documentNumber` (con fallback al valor existente en la reserva), `arrivalNotes`, `keyType`
- Payload audit en `StayJourneyEvent(CHECKED_IN)`: número de documento enmascarado `***1234` (PII — GDPR/LGPD)

**Frontend:**
- Step 1 (Reserva): campo `arrivalNotes` textarea + solicitudes especiales read-only
- Step 2 (Identidad): dropdown tipo documento + input número + checkbox (todos opcionales — no bloquean avanzar)
- Step 4 (Entrega + Confirmación): selector pill de 4 tipos de llave (PHYSICAL/CARD/CODE/MOBILE), requerido con default `PHYSICAL`
- `ReservationDetailPage` tab "Estadía": muestra documento enmascarado, tipo de llave con ícono, notas de llegada (si existen)

**Decisión: `keyType` requerido con default `PHYSICAL`** — cerrar el check-in sin registrar qué acceso se entregó es el gap más visible para auditoría. El default cubre el 80% de casos (LATAM usa llave física), la selección explícita deja trazabilidad.

**Decisión: `documentType`/`documentNumber` opcionales** — el checkbox es el forcing function de seguridad; el número es evidencia adicional para disputes. Enriquecer sin bloquear (principio Mews).

---

## Sprint 8F — Ventana Temporal de No-Show (Día Hotelero Real) ✅ Completado

### Problema resuelto

El sistema anterior permitía marcar no-show a las 4:00 PM del día de llegada — cuando el huésped no ha tenido tiempo suficiente para aparecer. Peor aún: a la 1:00 AM del día siguiente (mismo "día hotelero" antes del night audit), el bloque aparecía como `IN_HOUSE` verde aunque el huésped nunca llegó. Esta discrepancia generaba confusión operativa y potenciales conflictos fiscales.

### Modelo del día hotelero

El día hotelero en hotelería no termina a medianoche — termina en el night audit (default 2 AM). Esta es la convención estándar de la industria (Opera Cloud, Mews, ISAHC). Zenix ahora implementa este modelo correctamente en todos los cálculos de no-show.

### Configuración en `PropertySettings` (ya existía en schema)

| Campo | Default | Semántica |
|-------|---------|-----------|
| `potentialNoShowWarningHour` | `20` | Hora desde la que el badge/acción de no-show es visible |
| `noShowCutoffHour` | `2` | Hora en que el night audit corre — fin real del día hotelero |
| `timezone` | `"America/Cancun"` | Ambas horas son locales a la propiedad |

### Ventanas de acción resultantes

| Hora local | Estado visible | Acciones disponibles |
|-----------|---------------|---------------------|
| Llegada – 19:59 | `UNCONFIRMED` | Solo "Iniciar check-in" |
| 20:00 – 23:59 | `UNCONFIRMED` | "Iniciar check-in" + "Marcar no-show" (coexisten) |
| 00:00 – 01:59 (día siguiente, antes de audit) | `UNCONFIRMED` (no `IN_HOUSE`) | "Iniciar check-in" + "Marcar no-show" |
| ≥ 02:00 (post-audit) | `NO_SHOW` (si night audit corrió) | Solo "Revertir no-show" (< 48h) |

### Archivos modificados

**Frontend:**
- `apps/web/src/hooks/usePropertySettings.ts` *(nuevo)* — hook React Query para `GET /settings`
- `apps/web/src/modules/rooms/utils/timeline.utils.ts` — `getStayStatus()` acepta `nightAuditHour` como 6° parámetro opcional (backward-compatible, default 2). Nuevo caso UNCONFIRMED para "día siguiente antes del audit".
- `apps/web/src/modules/rooms/components/timeline/TimelineScheduler.tsx` — usa `usePropertySettings`, pasa props a `BookingsLayer`
- `apps/web/src/modules/rooms/components/timeline/BookingsLayer.tsx` — recibe y reenvía `potentialNoShowWarningHour` / `noShowCutoffHour` a cada `BookingBlock`
- `apps/web/src/modules/rooms/components/timeline/BookingBlock.tsx` — reescribe `isPotentialNoShow` con lógica temporal (`isArrivalCalendarDay`, `isPrevCalendarDay`, `isAfterWarningHour`). Pasa `auditHour` a `getStayStatus`.
- `apps/web/src/modules/rooms/components/timeline/TooltipPortal.tsx` — botón amber "↩ Revertir no-show" visible cuando `canRevert` (`differenceInHours(now, noShowAt) < 48`)

**Backend:**
- `apps/api/src/pms/guest-stays/guest-stays.service.ts` — guard en `markAsNoShow()` que lanza `ConflictException` si `checkinLocal === todayLocal && currentLocalHour < warningHour`. Usa `toLocalDate()` y `toLocalHour()` helpers existentes.

---

### TODO — Depósito en Garantía (Security Hold) — Sprint Futuro

> **Decisión: no implementar hasta demanda confirmada.** Los primeros clientes de Zenix pueden no cobrar depósito, y hacerlo requerido sería una limitante de ventas.

**Por qué es crítico para LATAM hostels:**
- Sin registro en el sistema, el supervisor no puede cuadrar si los depósitos en caja coinciden con los check-ins del día
- Muchos hostels usan voluntarios temporales — sin registro, el sistema no puede notificar: "Hoy hubo 8 check-ins con depósito de $100 c/u → debe haber $800 en caja"

**Diseño técnico (cuando se implemente):**

```prisma
// En GuestStay:
depositAmount       Decimal?       @map("deposit_amount") @db.Decimal(10,2)
depositMethod       DepositMethod? @map("deposit_method")
depositReturnedAt   DateTime?      @map("deposit_returned_at")
depositReturnedById String?        @map("deposit_returned_by_id")

// En PropertySettings:
requiresSecurityDeposit Boolean  @default(false) @map("requires_security_deposit")
defaultDepositAmount    Decimal? @map("default_deposit_amount") @db.Decimal(10,2)
depositCurrency         String   @default("MXN") @map("deposit_currency")

enum DepositMethod {
  CASH        // efectivo retenido en caja
  CARD_HOLD   // pre-autorización de tarjeta (sin cobro real)
  NONE        // exento con razón
}
```

*Control de caja (feature anti-robo):*
- `GET /v1/cash-summary` debe incluir `depositsHeld` = suma de `depositAmount` de check-ins del día donde `depositMethod = CASH` y `depositReturnedAt = null`
- Al hacer checkout con depósito cash, el recepcionista DEBE marcar `depositReturnedAt` + quién lo devolvió

*UX en wizard de check-in:*
- Step 3 agrega sección "Depósito en garantía" **solo si** `settings.requiresSecurityDeposit = true`
- "Exentar depósito" requiere razón + código de manager (misma UX que COMP)
- El depósito NO cuenta como pago del folio — es un concepto separado

*¿Por qué `CARD_HOLD` NO crea un `PaymentLog`?*
Un hold de tarjeta no es un ingreso (USALI 12ª ed.). Se registra en `GuestStay.depositMethod = CARD_HOLD` como intención; si se captura el hold al checkout, entonces sí se crea un `PaymentLog`.

---

## Sprint 9 Scope — Gestión de Tarifas + Channex.io

> Este sprint es independiente y dedicado. No mezclar con Sprint 8.

### Objetivos

1. **Rate Plans configurables por tipo de habitación**
   - Modelo `RatePlan { id, propertyId, roomTypeId, name, baseRate, currency, isActive }`
   - UI en Settings para crear/editar planes tarifarios
   - Soporte para tarifas de temporada, fin de semana, eventos especiales

2. **Modificación manual de precios por reserva**
   - Campo `rateOverride: Decimal?` en `GuestStay` con `rateOverrideReason: String?`
   - En modales de modificación: campo editable con razón obligatoria (auditable)
   - Permisos: solo `SUPERVISOR` o `MANAGER` pueden hacer overrides

3. **Sincronización bidireccional con Channex.io**
   - Webhook inbound: Channex → Zenix (reservas de OTAs)
   - Webhook outbound: Zenix → Channex (actualización de inventario/tarifas)
   - Documentación API: api.channex.io
   - Campos nuevos en `GuestStay`: `channexRateId`, `commissionRate`

4. **Historial de cambios de precio (audit trail)**
   - Modelo `PriceChangeLog { stayId, oldRate, newRate, reason, changedById, changedAt }`
   - Visible en tab "Historial" de `ReservationDetailPage`

5. **Revenue reports por canal**
   - `GET /reports/revenue` con breakdown por canal (directo, Booking.com, Airbnb, etc.)
   - `SUM(totalAmount - commissionRate * totalAmount)` = revenue neto
   - Exportable a CSV

6. **Cross-channel overbooking protection**
   - Channex.io allotment push en tiempo real cierra el 99% del gap
   - El hard-block de `checkAvailability` (ya existente) como segunda línea de defensa

### Campos preparados en schema (TODO — NO implementar hasta Sprint 8)

```prisma
// GuestStay — campos Sprint 8 (ver TODO comments en schema.prisma)
// ratePlanId        String?
// rateOverride      Decimal?
// rateOverrideReason String?
// channexRateId     String?
// commissionRate    Decimal?

// Nuevo modelo RatePlan
// model RatePlan { id, propertyId, roomTypeId, name, baseRate, currency,
//   channexRatePlanId, isActive, markup, createdAt, updatedAt }

// CleaningTask — campo Sprint 7A/7B
// sourceType CleaningTaskSource @default(CHECKOUT)
// enum CleaningTaskSource { CHECKOUT, STAYOVER, ROOM_CHANGE, EXTENSION }
```

### Limitación conocida hasta Sprint 8

El SSE Soft-Lock (Sprint 7C) protege solo overbooking intra-Zenix. Una reserva de Booking.com que llega por webhook mientras un recepcionista está en `CheckInDialog` NO activa el soft-lock. Protección: el hard-block de `checkAvailability` rechaza la segunda reserva. El primer recepcionista que confirma gana. Riesgo bajo para propiedades con 1-10 habitaciones y tráfico moderado.

---

## Módulo de Marketing — Sprint 9+ (scaffold listo)

**Ubicación:** `apps/api/src/marketing/` — archivos de pseudocode listos para implementar.

### Filosofía: PMS ↔ Marketing separation (Inmon 2005)

El módulo de marketing es **READ-ONLY** sobre datos del PMS. No modifica ningún modelo operacional (`GuestStay`, `StayJourney`, etc.). Su único trabajo es:
1. **Agregar** y **filtrar** datos existentes en cuatro segmentos accionables
2. **Exportar** esos segmentos en CSV/JSON para que el área administrativa los lleve a su CRM externo

Las campañas activas (emails, push, WhatsApp) se ejecutan en herramientas externas:
- **Mailchimp** — API v3, bulk import vía `POST /3.0/lists/{listId}/members`
- **HubSpot** — CRM API v3, `POST /crm/v3/objects/contacts/batch/create`
- **Brevo** (ex-Sendinblue) — `POST /v3/contacts/import`

El PMS exporta. El CRM ejecuta. Esta separación es la línea que distingue un sistema operacional de una plataforma de marketing — no mezclar.

### Cuatro segmentos MVP

| Segmento | Fuente de datos | Insight accionable |
|----------|-----------------|-------------------|
| **Extensiones** | `StaySegment WHERE reason IN [EXTENSION_*]` | Extendieron → alta disposición a quedarse más → candidatos para paquetes long-stay |
| **No-shows** | `GuestStay WHERE noShowAt IS NOT NULL` | Reservaron pero no llegaron → win-back con incentivo |
| **Huéspedes frecuentes** | `GROUP BY guestEmail HAVING COUNT >= 2` | Ya confían → programa de fidelidad, tarifa preferencial |
| **Alto valor** | `GROUP BY guestEmail SUM(totalAmount) >= threshold` | 80% del revenue viene del 20% de huéspedes (Pareto) → trato VIP |

### Data Network Effects — Estrategia de crecimiento (Sprint 9+)

**Hipótesis:** Con ~50 propiedades activas, los datos ANONIMIZADOS cross-propiedad tienen valor de mercado independiente del PMS.

**Use cases:**

1. **Benchmarks por ciudad (B2B, revenue stream directo):**
   - "Tu tasa de extensión en Cancún en Semana Santa: 18%. Promedio del mercado: 22%."
   - Los operadores pagan por estos insights para mejorar pricing y retención.

2. **Modelos predictivos de demanda (producto de BI para la consultora):**
   - Datos históricos cross-propiedad → forecasting de ocupación por evento, temporada, mercado emisor.
   - Integración con cubos OLAP para la consultora de BI.

3. **Benchmarks para OTAs (B2B2C, modelo STR/CoStar):**
   - Las OTAs pagan por inteligencia de mercado de sus partners.

**Principios de privacidad (no negociables):**
- Opt-in explícito: `Property.consentToAggregation = true` (campo pendiente, Sprint 9+)
- Anonimización ANTES de agregar: cero PII en datos cross-propiedad
- k-anonymity mínimo: si el filtro retorna < 5 propiedades → no retornar resultado
- Los datos brutos del huésped NUNCA salen de la propiedad propietaria

**Schema pendiente (Sprint 9+ — NO implementar antes):**
```prisma
// En Property:
consentToAggregation  Boolean   @default(false)
consentGrantedAt      DateTime?
consentGrantedById    String?

// Nuevo modelo:
model AggregatedCityReport {
  id            String   @id @default(uuid())
  city          String
  period        String   // 'YYYY-MM'
  propertyCount Int
  avgOccupancy  Float
  avgRevenue    Decimal
  extensionRate Float
  noShowRate    Float
  topSources    Json
  createdAt     DateTime @default(now())
  @@unique([city, period])
}
```

### Limitación hasta Sprint 9

El módulo de marketing actual (`ReportsPage ?tab=stays`) ya provee el export CSV del segmento de extensiones. Es el MVP mínimo. El `MarketingModule` completo (cuatro segmentos + API endpoints + integraciones CRM) se implementa en Sprint 9 cuando haya demanda operativa confirmada.

---

## Módulo DayUse — Etapa 3 (mercado motel/hotel de paso)

México tiene >25,000 moteles (SECTUR 2023). Colombia y Argentina tienen mercados similares. No existe un PMS moderno especializado en este segmento — **oportunidad de mercado pendiente**.

El módulo DayUse NO puede mezclarse con el calendario actual porque:
- El calendario actual usa `startOfDay` para todo (`stayToRect`, `getStayStatus`, `checkAvailability`)
- Las tarifas son por noche, no por hora o bloque
- La UI asume granularidad de días en el eje X

**Requerimientos del módulo DayUse (futura implementación):**
- Modelo `DayUseReservation` independiente de `GuestStay`
- UI con eje X en horas (6am–12pm, 12pm–6pm, 6pm–12am)
- Tarifa por bloque de horas con reglas fiscales diferenciadas por país
- Check-in/check-out en tiempo real (por hora, no por día)
- Integración con el mismo módulo de Housekeeping (limpieza entre turnos)

---

## Análisis del Flujo No-Show — Cobertura Zenix vs Competencia

> Perspectiva de ingeniero senior en procesos hoteleros. Fuentes: ISAHC, HFTP, Opera/Mews/Cloudbeds feature documentation, análisis de chargeback flows Visa/Mastercard para industria hotelera (LATAM).

### El ciclo completo de un no-show (perspectiva operativa)

En hotelería, un no-show no es un evento binario — es un **ciclo de 4 fases** con ventanas de acción y consecuencias distintas en cada una. La mayoría de los PMS del mercado solo cubren la Fase 3 (corte nocturno). Zenix cubre las 4.

```
FASE 1 (15:00–20:00)   FASE 2 (20:00–03:00)   FASE 3 (03:00 AM)      FASE 4 (post-48h)
─────────────────────  ─────────────────────  ─────────────────────  ─────────────────────
"El huésped no llegó"  "Alerta temprana"      "Night audit / corte"  "Registro inmutable"
Bloque visible         Pre-arrival cron        Marca no-show          Fiscal + reportes
                       WhatsApp automático     Libera inventario
                       GuestContactLog         Cargo → pasarela
```

---

### Fase 1 — 15:00 a 20:00: El huésped no llega (nadie lo sabe aún)

**Operación hotelera real:** El check-in estándar es a las 15:00. Si a las 20:00 el huésped no ha llegado ni contactado, hay alta probabilidad de no-show. Este intervalo es crítico: es la última ventana donde el huésped puede confirmar llegada tardía sin consecuencias.

**Zenix (§34):** El bloque permanece visible en el calendario con el color original. Ningún cambio de estado automático. El recepcionista sigue viendo la habitación como "reservada por llegar". Esto es correcto operativamente: cambiar el estado antes del corte nocturno causaría re-venta prematura y conflicto si el huésped llega a las 22:00.

**Competencia:**
- Opera Cloud, Mews, Cloudbeds: el bloque permanece visible pero **sin ningún mecanismo de alerta temprana**. El equipo de recepción descubre el no-show al día siguiente.
- Clock PMS+: tiene "arrival alert" pero es manual — nadie lo activa sistemáticamente.
- **Ningún PMS** del mercado tiene detección automática pre-audit en esta ventana.

---

### Fase 2 — 20:00: Pre-arrival warming (ventaja exclusiva Zenix)

**Operación hotelera real:** En LATAM, el 60% de los no-shows son **llegadas tardías mal comunicadas** (Amadeus Hospitality Research 2022). El huésped tomó un vuelo retrasado, perdió la conexión, o simplemente olvidó avisar. Un mensaje proactivo a las 20:00 convierte potenciales no-shows en llegadas tardías — elimina el costo del cargo antes de que exista y protege la relación con el huésped.

**Zenix:** `PotentialNoShowScheduler` evalúa cada estadía sin `actualCheckIn` a la hora configurable (default: 20:00 local). Por cada estadía en riesgo:

1. Emite SSE `arrival:at_risk` → bloque recibe visual amber border en el calendario
2. Si `PropertySettings.enableAutoOutreach = true`: envía WhatsApp vía 360Dialog + email vía Postmark automáticamente
3. Registra **cada intento** en `GuestContactLog { stayId, channel, sentAt, messagePreview, sentById: null (sistema) }` — evidencia inmutable para disputas de chargeback

**Ventaja técnica en LATAM:**
- WhatsApp tiene >85% tasa de apertura en México, Colombia, Argentina (vs ~20% email)
- `GuestContactLog` es exactamente la evidencia que Visa/Mastercard pide para rechazar un chargeback: "El establecimiento intentó contactar al titular a las 20:15 vía WhatsApp antes de aplicar el cargo de no-show"
- El log es append-only — nunca se puede modificar ni eliminar. Cumple con los requisitos de evidencia de la Red de Pagos (Visa Core Rules §5.9.2)

**Competencia:** Ningún PMS del mercado (Opera, Mews, Cloudbeds, Guesty, Hostaway) envía WhatsApp automático pre-audit. Solo email, y sin log de dispute-grade.

---

### Fase 3 — 03:00 AM: Night audit

**Operación hotelera real:** El "night audit" es el cierre contable del día. En hotelería tradicional, un auditor nocturno revisa manualmente las llegadas pendientes y marca no-shows. Los PMS modernos automatizan esto con un cron job.

| Sub-proceso | Zenix | Opera Cloud | Mews | Cloudbeds | Clock PMS+ |
|-------------|-------|-------------|------|-----------|------------|
| Auto-marca no-show | ✅ configurable | ✅ fijo 3 AM | ✅ | ✅ | ✅ |
| Multi-timezone por propiedad | ✅ IANA real | ❌ server TZ | ❌ UTC | ❌ UTC | ❌ UTC |
| Idempotencia (doble-proceso) | ✅ `noShowProcessedDate` | ❌ | ❌ | ❌ | ❌ |
| Bloque visual diferenciado (NS) | ✅ rayas + badge | ✅ | ✅ | ⚠️ solo color | ✅ |
| Libera inventario inmediato | ✅ `noShowAt: null` guard | ✅ | ✅ | ✅ | ✅ |
| Push Channel Manager | ⚠️ stub Sprint 8C | ✅ | ✅ | ✅ | ✅ |
| Cargo procesado automático | ❌ Sprint 8A | ✅ Stripe | ✅ Adyen | ⚠️ manual | ⚠️ manual |
| Audit trail con actor | ✅ `noShowById` | ✅ | ✅ | ❌ | ⚠️ sin razón |
| Reversión con actor | ✅ `noShowRevertedById` | ❌ | ✅ | ❌ | ⚠️ sin actor |
| `waiveCharge` auditado | ✅ backend | ❌ | ❌ | ❌ | ❌ |
| Cumplimiento fiscal LATAM (CFDI) | ✅ export CSV ready | ❌ | ❌ | ❌ | ❌ |

**La ventaja más diferenciadora del mercado:** multi-timezone con `Intl.DateTimeFormat` por propiedad evaluado independientemente. Una cadena con hoteles en Cancún, Medellín y Madrid recibe el corte a las 2 AM de cada ciudad — sin configuración extra. Opera/Cloudbeds corren el audit a la misma hora UTC para todas las propiedades: en México eso puede ser las 8 PM, aún horario operativo. Esto es un bug documentado en foros de usuarios de Cloudbeds (Community thread "Night audit fires too early for Mexico properties", 2024).

---

### Fase 4 — Mañana: revertir, cobrar, o cerrar

**Operación hotelera real:** Al día siguiente, el supervisor tiene tres decisiones:
1. **Revertir** — el huésped llegó tarde, error del sistema, o disputa legítima
2. **Cobrar** — aplicar el cargo de no-show a la tarjeta guardada
3. **Perdonar** — huésped frecuente, fuerza mayor, política de cortesía

**Zenix cubre:**
- ✅ Reversión dentro de ventana de 48h con guard temporal (`differenceInHours(now, noShowAt) > 48 → ForbiddenException`)
- ✅ Audit trail completo: `noShowRevertedAt`, `noShowRevertedById`, razón registrada
- ✅ `waiveCharge` en backend con razón obligatoria → `noShowChargeStatus: WAIVED`
- ❌ **GAP CRÍTICO Sprint 8A:** No hay pasarela de pago conectada. `noShowChargeStatus` tiene el ciclo de vida correcto pero `PENDING → CHARGED` no ejecuta ningún cobro real todavía
- ⚠️ **GAP UI Sprint 8A:** Los botones "Cobrar" y "Perdonar cargo" no existen en `BookingDetailSheet`

---

### Fase 5 — Post-48h: registro inmutable y reportes fiscales

**Operación hotelera real:** Después de 48h, el no-show es un hecho contable. El registro debe:
- Estar disponible para auditoría fiscal (SAT México, DIAN Colombia, SUNAT Perú)
- Ser la fuente de verdad para disputas de chargeback (hasta 120 días después del cargo en Visa/Mastercard)
- Alimentar métricas de revenue management (tasa de no-show = KPI estándar de la industria)

**Zenix:**
- ✅ No hard-delete nunca. Anonimización GDPR de PII manteniendo registros fiscales
- ✅ `GET /reports/no-shows` con export CSV: amounts, currency, timestamps, actores — listo para CFDI 4.0
- ✅ `ReportsPage ?tab=noshow` con filtros por rango de fechas, canal, estado de cargo
- ❌ **GAP UI Sprint 8B:** Toggle "Ocultar no-shows" del calendario — §34 lo documenta como necesario pero no implementado

---

### Resumen de cobertura actual

| Paso del flujo | Estado | Sprint |
|----------------|--------|--------|
| Bloque visible al no llegar | ✅ | — |
| Alerta visual amber a las 20:00 | ✅ | — |
| WhatsApp/email automático pre-audit | ✅ (providers stub) | — |
| GuestContactLog append-only | ✅ | — |
| Night audit multi-timezone | ✅ | — |
| Idempotencia `noShowProcessedDate` | ✅ | — |
| Visual diferenciado (rayas + badge NS) | ✅ | — |
| Libera inventario `noShowAt: null` | ✅ | — |
| Push Channel Manager (Channex.io) | ⚠️ stub | 8C |
| Cargo procesado automático (Stripe/Conekta) | ❌ | 8A |
| UI "Cobrar cargo" en BookingDetailSheet | ❌ | 8A |
| UI "Perdonar cargo" con razón | ❌ | 8A |
| Reversión 48h con audit trail | ✅ | — |
| waiveCharge backend | ✅ | — |
| Filtro "Ocultar no-shows" en calendario | ❌ | 8B |
| Registro inmutable post-48h | ✅ | — |
| Reportes fiscales CSV (CFDI-ready) | ✅ | — |

---

### Ventajas competitivas exclusivas de Zenix

**1. Pre-arrival warming a las 20:00 (ningún PMS lo tiene)**
El ciclo tiene un paso extra que Opera, Mews, Cloudbeds y Clock PMS+ no implementan: detección temprana + outreach automático + registro de evidencia. El night audit es el último recurso, no el primero.

**2. WhatsApp nativo LATAM vía 360Dialog**
85% de tasa de apertura vs 20% email. El recepcionista no tiene que hacer nada — el sistema contacta al huésped automáticamente. El log queda en `GuestContactLog` como evidencia.

**3. GuestContactLog como evidencia de disputa Visa/Mastercard**
Log append-only con `channel`, `sentAt`, `messagePreview`, `sentById`. Cumple Visa Core Rules §5.9.2 para evidencia de contacto previo al cargo. Ningún PMS del mercado tiene este registro estructurado.

**4. Multi-timezone real por propiedad**
`Intl.DateTimeFormat` con IANA timezone evaluado independientemente por propiedad. Una cadena regional funciona desde el día 1. Opera/Cloudbeds tienen este bug documentado en producción.

**5. Audit trail fiscal-grade con actores y razones**
`noShowById`, `noShowRevertedById`, `noShowReason`, timestamps UTC. Exportable a CFDI 4.0 (MX), DIAN (CO), SUNAT (PE). Mews tiene audit trail pero sin cumplimiento LATAM. Opera tiene cumplimiento pero requiere ERP externo.

**6. `noShowChargeStatus` enum con ciclo de vida fiscal explícito**
`NOT_APPLICABLE → PENDING → CHARGED | FAILED | WAIVED`. Granularidad que no existe en Cloudbeds (boolean) ni Clock PMS+. Permite `SUM(amount) WHERE status = CHARGED` para revenue real vs `WAIVED` para cortesías auditadas.

**7. Reversión con `waiveCharge` auditado**
Mews tiene revert pero sin razón obligatoria ni cumplimiento fiscal LATAM post-revert. Zenix registra quién perdonó, cuándo, y por qué — evidencia ante una auditoría fiscal.

---

### Plan de Sprints pendientes del flujo no-show

#### Sprint 8A — Payment processing (bloquea revenue real)
**Prioridad: CRÍTICA** — sin esto, `noShowChargeStatus` queda en `PENDING` indefinidamente.

| Tarea | Archivos | Esfuerzo |
|-------|----------|----------|
| Nuevo módulo `apps/api/src/payments/` con `PaymentService.chargeNoShow(stayId)` | `payments.service.ts`, `payments.module.ts` | 2 días |
| Integración Stripe (internacional) o Conekta (MX: OXXO + tarjetas) | `stripe.provider.ts` / `conekta.provider.ts` | 1 día |
| UI "💳 Procesar cargo $X MXN" en `BookingDetailSheet` | `BookingDetailSheet.tsx` | 0.5 día |
| UI "🤝 Perdonar cargo + razón obligatoria" en `BookingDetailSheet` | `BookingDetailSheet.tsx` | 0.5 día |
| Log en `StayJourney` cuando cargo es CHARGED/FAILED/WAIVED | `stay-journeys.service.ts` | 0.5 día |

**Flujo:**
```
BookingDetailSheet (visible solo si noShowAt != null && chargeStatus == PENDING)
├── [💳 Procesar cargo $X MXN]  → PaymentService.chargeNoShow()
│     → noShowChargeStatus: CHARGED
│     → StayJourneyEvent { type: 'CHARGE_PROCESSED', amount, currency }
│     → toast "Cargo procesado ✓"
└── [🤝 Perdonar cargo]         → input razón (obligatorio) → confirm
      → noShowChargeStatus: WAIVED
      → StayJourneyEvent { type: 'CHARGE_WAIVED', reason, staffId }
      → toast "Cargo perdonado"
```

#### Sprint 8B — Filtro "Ocultar no-shows" en calendario
**Prioridad: MEDIA** — operativa sin él, pero §34 lo requiere.

| Tarea | Archivos | Esfuerzo |
|-------|----------|----------|
| Toggle button en `TimelineSubBar.tsx` | `TimelineSubBar.tsx` | 2h |
| Estado en URL param `?hideNoShows=1` | `TimelineScheduler.tsx` | 1h |
| Filtrar bloques con `noShowAt != null` en `BookingsLayer.tsx` | `BookingsLayer.tsx` | 1h |

Default: visible (toggle OFF = mostrar todo). Patrón igual al de `?tab=` en DailyPlanningPage.

#### Sprint 8C — Channex.io inventory push real
**Prioridad: MEDIA** — bloquea cross-channel overbooking protection.

`ChannexGateway.pushInventory()` es stub no-op. Cuando night audit libera un cuarto por no-show, el Channel Manager no recibe la actualización. Booking.com puede vender el cuarto antes de que Channex sincronice.

Archivo: `apps/api/src/integrations/channex/channex.gateway.ts`. API documentada en §30.

#### Sprint 8D — `animate-pulse` en `arrival:at_risk` (cosmético)
**Prioridad: BAJA.** Reemplazar el amber border estático con `animate-pulse border-2 border-amber-400` + dot badge `⏰` top-right en `BookingBlock.tsx`.

---

## Sprint 7C — SSE Soft-Lock: Explicación Detallada

### Contexto operativo hotelero

En un hotel con recepción activa, es común que dos recepcionistas trabajen en turnos superpuestos o simultáneamente. Sin ningún mecanismo de coordinación, puede ocurrir este escenario:

```
Recepcionista A (turno día):          Recepcionista B (turno noche):
10:55 — Abre BookingDetailSheet       10:55 — Abre BookingDetailSheet
        para Hab. 205, busca           para Hab. 205, busca
        disponibilidad del 25 al 28    disponibilidad del 25 al 28
10:56 — Ve "disponible"               10:56 — Ve "disponible"
10:57 — Confirma reserva Huésped A    10:57 — Confirma reserva Huésped B
10:57 — ✅ checkAvailability pasa      10:57 — ❌ checkAvailability falla
                                               (hard-block: 409 Conflict)
                                       10:57 — "Error: habitación ocupada"
                                               → confusión operativa
```

El hard-block de `checkAvailability` **previene el overbooking** — el segundo intento siempre falla. Pero la experiencia del usuario es confusa: el recepcionista B vio "disponible" hace 30 segundos y ahora recibe un error sin explicación. En un hotel con 15+ habitaciones y 2 recepcionistas, esto ocurre varias veces por semana.

**El soft-lock resuelve la experiencia, no la seguridad.** La seguridad ya está resuelta por el hard-block.

### Qué hace el soft-lock exactamente

Cuando un recepcionista abre un diálogo de reserva o modificación para una habitación específica:

1. El frontend llama `POST /v1/rooms/:id/soft-lock/acquire` → el servidor registra "Usuario X está gestionando Hab. 205, TTL: 90s"
2. El servidor emite SSE `soft:lock:acquired { roomId, lockedByName, expiresAt }` a todos los clientes de esa propiedad
3. **Otros recepcionistas** que estén mirando el calendario ven un badge visual sobre la habitación: `🔒 En uso por María G.`
4. Cuando el recepcionista A termina (confirma o cancela), el frontend llama `DELETE /v1/rooms/:id/soft-lock` → SSE `soft:lock:released`
5. El badge desaparece para todos

### Por qué 90 segundos de TTL

El TTL es un fallback para casos de crash o tab cerrada sin cleanup limpio. En condiciones normales, el lock se libera inmediatamente al cerrar el diálogo (cleanup del `useEffect`). Los 90s son el peor caso: si el navegador del recepcionista A muere sin ejecutar el cleanup, el lock expira solo en 90s — un tiempo corto para que el recepcionista B no se quede esperando sin información.

### Por qué in-memory (sin Prisma)

Los soft-locks son ephemeros por diseño. Persistirlos en la base de datos sería:
- Innecesario: un lock de 90s no necesita sobrevivir un reinicio del servidor
- Costoso: cada heartbeat (cada 30s) haría un UPDATE en Prisma
- Complejo: necesitaría un scheduler de limpieza de locks expirados

Un `Map<string, LockEntry>` en memoria del proceso NestJS es suficiente. Si el servidor reinicia, todos los locks desaparecen — los recepcionistas simplemente no verán el badge por un momento, y la protección real (hard-block) sigue intacta.

### Componentes a implementar

**Backend — nuevo módulo `apps/api/src/soft-lock/`:**

```typescript
// soft-lock.service.ts
@Injectable()
export class SoftLockService {
  private locks = new Map<string, { userId: string; userName: string; expiresAt: Date }>()

  acquire(roomId: string, userId: string, userName: string): 'acquired' | 'already_locked'
  release(roomId: string, userId: string): void
  heartbeat(roomId: string, userId: string): void   // renueva TTL a now + 90s
  getStatus(roomId: string): { locked: boolean; byName?: string } | null
  
  @Cron('* * * * *')  // cada minuto
  sweepExpired(): string[]  // retorna roomIds de locks expirados para emitir SSE released
}
```

**Endpoints:**
```
POST   /v1/rooms/:id/soft-lock/acquire    → { acquired: true } | { acquired: false, lockedBy: 'María G.' }
DELETE /v1/rooms/:id/soft-lock            → 204 No Content
PATCH  /v1/rooms/:id/soft-lock/heartbeat  → 204 No Content
```

**SSE events en `packages/shared/src/types.ts`:**
```typescript
// Agregar a SseEventType:
'soft:lock:acquired' | 'soft:lock:released'

// Payload:
interface SoftLockAcquiredEvent { roomId: string; lockedByName: string; expiresAt: string }
interface SoftLockReleasedEvent { roomId: string }
```

**Frontend — `apps/web/src/hooks/useSoftLock.ts`:**
```typescript
export function useSoftLock(roomId: string | null) {
  useEffect(() => {
    if (!roomId) return
    api.post(`/v1/rooms/${roomId}/soft-lock/acquire`)
    const heartbeat = setInterval(() => {
      api.patch(`/v1/rooms/${roomId}/soft-lock/heartbeat`)
    }, 30_000)
    return () => {
      clearInterval(heartbeat)
      api.delete(`/v1/rooms/${roomId}/soft-lock`)  // cleanup inmediato al cerrar
    }
  }, [roomId])
}
```

**Visual en calendario:** Badge `🔒 [nombre truncado]` en amber en la fila de `RoomColumn` correspondiente a la habitación bloqueada. El bloque de reserva NO se deshabilita — el recepcionista B puede igualmente intentar la reserva; el badge es advertencia, no barrera.

**Comportamiento con múltiples recepcionistas en la misma habitación:** El backend mantiene una sola entrada `Map<roomId, LockEntry>` por habitación. Si varios recepcionistas abren la misma habitación simultáneamente, cada `acquire` sobreescribe la entrada anterior — el badge muestra el nombre del último en adquirir. Todos los heartbeats renuevan el TTL independientemente. Esto es correcto por diseño: el objetivo del badge es comunicar "alguien está aquí", no listar a todos. Si recepcionistas A, B y C abren la misma habitación para fechas distintas, los tres pueden confirmar sin conflicto siempre que las fechas no se superpongan (el hard block los atrapa si sí).

**Distinción por tipo de lock (fechas vs. habitación):** El lock es a nivel de `roomId`, no de rango de fechas. Un recepcionista 6 que abre la misma habitación que el 1 para fechas completamente distintas verá el badge pero su reserva no tiene impedimento real — `checkAvailability` confirmará disponibilidad en su rango y el servidor la creará sin conflicto. El soft-lock informa; el servidor decide.

### Diferencia con un mutex real

| Característica | Soft-Lock (Zenix) | Mutex real (DB pessimistic lock) |
|----------------|-------------------|---------------------------------|
| Previene overbooking | ❌ No (advisory) | ✅ Sí (bloqueante) |
| UX cuando hay conflicto | ✅ Informativa | ❌ "Error 423 Locked" |
| Requiere BD | ❌ In-memory | ✅ SELECT FOR UPDATE |
| Funciona cross-servidor | ❌ Por proceso | ✅ Centralizado |
| Complejidad | Baja | Alta |
| Necesario en Zenix | Para UX | Ya cubierto por hard-block |

---

## Bitácora de Funcionalidades

> Registro cronológico de todas las funcionalidades implementadas y en roadmap. Sirve como base para la documentación de usuario y el módulo de onboarding. Actualizar con cada sprint.

### Leyenda
- ✅ **Implementado** — en producción / listo para deploy
- ⚠️ **Parcial** — backend listo, UI pendiente (o viceversa)
- 🔄 **En progreso** — sprint actual
- ⏳ **Planificado** — sprint asignado
- 📋 **Roadmap** — sin sprint asignado aún
- 🚫 **Descartado** — decisión definitiva

---

### Módulo: Housekeeping (Operaciones de Limpieza)

| # | Funcionalidad | Estado | Sprint | Rol que lo usa | Notas |
|---|---------------|--------|--------|----------------|-------|
| HK-01 | Planificación matutina de salidas (grid visual) | ✅ | Etapa 1 | Recepcionista | DailyPlanningPage tab 1 |
| HK-02 | Marcado per-bed de checkout con urgencia | ✅ | Etapa 1 | Recepcionista | `hasSameDayCheckIn` per-task |
| HK-03 | Confirmación de planificación (`batchCheckout`) | ✅ | Etapa 1 | Recepcionista | `POST /checkouts/batch` |
| HK-04 | Confirmación de salida física por cama (`confirmDeparture`) | ✅ | Etapa 1 | Recepcionista | Fase 2 del flujo de 2 fases |
| HK-05 | Reversión de salida física (`undoDeparture`) | ✅ | Etapa 1 | Recepcionista | Solo pre-limpieza |
| HK-06 | Cancelación de checkout per-bed y per-checkout | ✅ | Etapa 1 | Recepcionista | Extensión de estadía |
| HK-07 | Estado en Tiempo Real (tab 2 DailyPlanningPage) | ✅ | Etapa 1 | Recepcionista | SSE-driven |
| HK-08 | Push notifications a housekeepers | ✅ | Etapa 1 | Sistema | Expo Push API |
| HK-09 | Lista de tareas en mobile (app housekeeper) | ✅ | Etapa 1 | Housekeeper | `rooms.tsx` |
| HK-10 | Ciclo de limpieza: start/pause/resume/end | ✅ | Etapa 1 | Housekeeper | `task/[id].tsx` |
| HK-11 | Verificación de tareas por supervisor | ✅ | Etapa 1 | Supervisor | `POST /tasks/:id/verify` |
| HK-12 | Cola offline en mobile (sync al reconectar) | ✅ | Etapa 1 | Housekeeper | `syncManager.ts` |
| HK-13 | KanbanPage (board supervisor) | ⚠️ | Etapa 1 | Supervisor | Esqueleto — pendiente UI completa |
| HK-14 | Asignación manual de tareas | ⚠️ | Etapa 1 | Supervisor | Backend OK, UI en KanbanPage pendiente |
| HK-15 | Reportes de discrepancias (cama vs estado) | ⚠️ | Etapa 1 | Supervisor | Endpoint existe, UI de resolución pendiente |
| HK-16 | Tareas stayover (limpieza de estadías largas) | 📋 | Roadmap P1 | Sistema | `StayoverService` — ver §Roadmap |
| HK-17 | Checklists de limpieza por tipo de habitación | 📋 | Roadmap P2 | Housekeeper | Con fotos opcionales |
| HK-18 | Auto-asignación por secciones (habitaciones fijas por housekeeper) | 📋 | Roadmap P3 | Sistema | |
| HK-19 | Reporte de mantenimiento desde mobile | 📋 | Roadmap P7 | Housekeeper | Módulo Maintenance |

---

### Módulo: PMS — Calendario de Reservas

| # | Funcionalidad | Estado | Sprint | Rol que lo usa | Notas |
|---|---------------|--------|--------|----------------|-------|
| PMS-01 | Calendario tipo timeline (habitación × día) | ✅ | Sprint 6 | Recepcionista | `TimelineScheduler.tsx` |
| PMS-02 | Bloques de reserva en grid con colores por OTA | ✅ | Sprint 6 | Recepcionista | `SOURCE_COLORS`, `OTA_ACCENT_COLORS` |
| PMS-03 | Drag & drop de reservas entre habitaciones | ✅ | Sprint 7A | Recepcionista | `MoveRoomDialog` con confirmación |
| PMS-04 | Extensión de estadía arrastrando borde derecho | ✅ | Sprint 7A | Recepcionista | `ExtendConfirmDialog` |
| PMS-05 | Extensión con pricing aditivo (no recalculativo) | ✅ | Sprint 7A | Recepcionista | §22 decisión de diseño |
| PMS-06 | Extensión en otra habitación (con auto-detect de conflicto) | ✅ | Sprint 7B | Recepcionista | Pre-flight check + selector de alternativas del mismo tipo |
| PMS-07 | SSE Soft-Lock advisory (badge "en uso") | ✅ | Sprint 7C | Recepcionista | Badge 🔒 en RoomColumn; lock en CheckInDialog + BookingDetailSheet |
| PMS-21 | Salida anticipada (early checkout manual) | ✅ | Sprint 7D | Recepcionista | `BookingDetailSheet.tsx`, `EarlyCheckoutDialog`, `POST /early-checkout` |
| PMS-08 | Tooltip de reserva (flip top/bottom) | ✅ | Sprint 6 | Recepcionista | `TooltipPortal.tsx` |
| PMS-09 | Panel de detalle de reserva 420px | ✅ | Sprint 6 | Recepcionista | `BookingDetailSheet.tsx` |
| PMS-10 | Página de detalle completo de reserva | ✅ | Sprint 6 | Recepcionista | `ReservationDetailPage.tsx` |
| PMS-11 | Ghost block para celdas vacías (nueva reserva) | ✅ | Sprint 7A | Recepcionista | `TimelineGrid.tsx` |
| PMS-12 | Journey lines SVG (visualiza traslados de habitación) | ✅ | Sprint 6 | Recepcionista | `BookingsLayer.tsx` |
| PMS-13 | Columna de hoy resaltada (emerald) | ✅ | Sprint 6 | Recepcionista | `TodayColumnHighlight.tsx` |
| PMS-14 | Vista semana y mes con navegación | ✅ | Sprint 7A | Recepcionista | `TimelineSubBar.tsx` |
| PMS-15 | Bloqueo visual de habitación ocupada durante drag | ✅ | Sprint 7A | Recepcionista | `DragGhost.tsx` con 🚫 |
| PMS-16 | Split mid-stay con routing | ✅ | Sprint 7A | Recepcionista | `EXTENSION_NEW_ROOM` segment |
| PMS-17 | Effective-date picker para traslados | ✅ | Sprint 7A | Recepcionista | `MoveRoomDialog.tsx` |
| PMS-18 | Filtro "Ocultar no-shows" en calendario | ⏳ | Sprint 8B | Recepcionista | Toggle `?hideNoShows=1` |
| PMS-19 | OccupancyFooter con colores por ocupación | ⏳ | Sprint 7A pendiente | Supervisor | ≥80% rojo, 50-79% amber, <50% emerald |
| PMS-20 | Extender en otra propiedad (cadenas) | 📋 | Etapa 3 | Recepcionista | Cross-property inventory |

---

### Módulo: No-Shows y Gestión Fiscal

| # | Funcionalidad | Estado | Sprint | Rol que lo usa | Notas |
|---|---------------|--------|--------|----------------|-------|
| NS-01 | Marcar no-show manualmente (recepcionista) | ✅ | Sprint 5 | Recepcionista | `NoShowConfirmModal.tsx` |
| NS-02 | Night audit automático multi-timezone | ✅ | Sprint 5 | Sistema | `NightAuditScheduler` |
| NS-03 | Idempotencia del corte (`noShowProcessedDate`) | ✅ | Sprint 5 | Sistema | Guard anti-double-process |
| NS-04 | Reversión de no-show (ventana 48h) | ✅ | Sprint 5 | Recepcionista/Supervisor | `revertNoShow` endpoint |
| NS-05 | Bloque visual diferenciado (rayas + badge NS) | ✅ | Sprint 6 | Recepcionista | §34 — siempre visible |
| NS-06 | Liberación inmediata de inventario | ✅ | Sprint 5 | Sistema | `noShowAt: null` en `checkAvailability` |
| NS-07 | Pre-arrival warming (alerta 20:00 local) | ✅ | Sprint 5/6 | Sistema | `PotentialNoShowScheduler` |
| NS-08 | Outreach automático WhatsApp + email | ✅ | Sprint 5/6 | Sistema | 360Dialog + Postmark (providers stub) |
| NS-09 | GuestContactLog (log de intentos de contacto) | ✅ | Sprint 6 | Sistema | Append-only, evidencia Visa/MC |
| NS-10 | Audit trail fiscal (`noShowById`, razón, timestamps) | ✅ | Sprint 5 | Sistema | Inmutable |
| NS-11 | Reporte de no-shows con export CSV | ✅ | Sprint 5 | Supervisor/Contabilidad | CFDI-ready |
| NS-12 | Cargo de no-show (procesamiento en pasarela) | ❌ | Sprint 8A | Supervisor | Stripe/Conekta — pendiente |
| NS-13 | UI "Cobrar" y "Perdonar cargo" | ❌ | Sprint 8A | Supervisor | `BookingDetailSheet.tsx` |
| NS-14 | Push Channel Manager al marcar no-show | ⚠️ | Sprint 8C | Sistema | `ChannexGateway` stub |
| NS-15 | Filtro "Ocultar no-shows" en calendario | ❌ | Sprint 8B | Recepcionista | Toggle UI |
| NS-16 | `animate-pulse` en bloque `arrival:at_risk` | ⏳ | Sprint 8D | Sistema | Mejora visual cosmética |
| NS-17 | Ventana temporal de no-show (día hotelero real) | ✅ | Sprint 8F | Sistema/Recepcionista | `potentialNoShowWarningHour` + `noShowCutoffHour`; guard backend en `markAsNoShow()` |
| NS-18 | Botón "Revertir no-show" en tooltip (< 48h) | ✅ | Sprint 8F | Recepcionista | Botón amber en `TooltipPortal` visible solo cuando `canRevert` (< 48h desde `noShowAt`) |

---

### Módulo: Check-in / Gestión de Huéspedes

| # | Funcionalidad | Estado | Sprint | Rol que lo usa | Notas |
|---|---------------|--------|--------|----------------|-------|
| CI-01 | Crear reserva desde calendario (ghost block) | ✅ | Sprint 7A | Recepcionista | `POST /v1/guest-stays` |
| CI-02 | Verificar disponibilidad antes de crear reserva | ✅ | Sprint 6 | Sistema | `AvailabilityService` |
| CI-03 | Check-out de estadía | ✅ | Sprint 6 | Recepcionista | `POST /v1/guest-stays/:id/checkout` |
| CI-04 | Traslado de habitación mid-stay | ✅ | Sprint 7A | Recepcionista | `executeMidStayRoomMove` |
| CI-05 | Historial de eventos de estadía (audit trail) | ✅ | Sprint 6 | Recepcionista | Tab "Historial" en `ReservationDetailPage` |
| CI-06 | Integración Channex.io (webhooks OTA) | ⚠️ | Sprint 8C | Sistema | Gateway stub |
| CI-07 | Rate plans configurables por habitación | ⏳ | Sprint 8 | Supervisor/Admin | |
| CI-08 | Override manual de precio con razón auditada | ⏳ | Sprint 8 | Supervisor | `rateOverride` field |
| CI-09 | Preferencias de limpieza del huésped (opt-in) | 📋 | Roadmap P6 | Huésped/Recepcionista | QR + web form |
| CI-10 | Gestión de pagos en check-in (CASH/CARD/OTA/COMP) | ✅ | Sprint 8 | Recepcionista | `PaymentLog` append-only, `confirmCheckin` endpoint, split payment |
| CI-11 | Confirmación manual de llegada (`actualCheckin`) | ✅ | Sprint 8 | Recepcionista | Status `UNCONFIRMED` → `IN_HOUSE`; `ConfirmCheckinDialog` 4 pasos |
| CI-12 | Cash reconciliation por turno (anti-robo) | ✅ | Sprint 8 | Supervisor | `GET /cash-summary?date=X` agrupado por recepcionista |
| CI-13 | Void de pagos (registro negativo, original intacto) | ✅ | Sprint 8 | Supervisor | `voidPayment()` — USALI 12ª ed. |
| CI-14 | Captura de documento en check-in (tipo + número enmascarado) | ✅ | Sprint 8E | Recepcionista | `documentType`, `documentNumber` en `ConfirmCheckinDialog` Step 2 |
| CI-15 | Tipo de llave entregada (`keyType`) | ✅ | Sprint 8E | Recepcionista | Selector pill 4 opciones, default PHYSICAL |
| CI-16 | Notas de llegada (`arrivalNotes`) | ✅ | Sprint 8E | Recepcionista | Textarea en Step 1, visible en `ReservationDetailPage` |
| CI-17 | Depósito en garantía (security hold) | 📋 | Roadmap | Recepcionista | Ver TODO en CLAUDE.md §Sprint 8E |

---

### Módulo: Notification Center

| # | Funcionalidad | Estado | Sprint | Rol que lo usa | Notas |
|---|---------------|--------|--------|----------------|-------|
| NC-01 | Panel de notificaciones (bell icon → slide-in) | ✅ | Sprint 7D | Todos | `NotificationPanel.tsx` — 3 secciones: urgente/acción/info |
| NC-02 | Badge de no leídas en tiempo real (SSE) | ✅ | Sprint 7D | Todos | `notification:new` via SSE + React Query |
| NC-03 | Marcar como leída (por notificación y todas) | ✅ | Sprint 7D | Todos | `markRead`, `markAllRead` con optimistic UI |
| NC-04 | Notificaciones de aprobación inline (aprobar/rechazar) | ✅ | Sprint 7D | Supervisor | `APPROVAL_REQUIRED` con botones in-card |
| NC-05 | Audit trail completo (quién leyó, quién aprobó, cuándo) | ✅ | Sprint 7D | Sistema | `AppNotificationRead`, `AppNotificationApproval` Prisma |
| NC-06 | Auto-notificación en early checkout | ✅ | Sprint 7D | Sistema | `NotificationCenterService.send()` en `GuestStaysService` |
| NC-07 | Auto-notificación en no-show | ✅ | Sprint 7D | Sistema | Notif. `ACTION_REQUIRED` al supervisor si hay cargo pendiente |
| NC-08 | Endpoint de audit log | ✅ | Sprint 7D | Admin | `GET /v1/notification-center/audit` con rango de fechas |
| NC-09 | Expiración automática de notificaciones | ✅ | Sprint 7D | Sistema | Campo `expiresAt` — excluidas del list después de vencidas |
| NC-10 | Filtro de recipient (USER / ROLE / PROPERTY_ALL) | ✅ | Sprint 7D | Sistema | Cada notif. va al usuario correcto, no a todos |

---

### Módulo: Mantenimiento

| # | Funcionalidad | Estado | Sprint | Rol que lo usa | Notas |
|---|---------------|--------|--------|----------------|-------|
| MT-01 | Reporte de ticket desde mobile (housekeeper) | 📋 | Roadmap P7 | Housekeeper | Foto + categoría + descripción |
| MT-02 | Kanban de tickets de mantenimiento (web) | 📋 | Roadmap P7 | Supervisor/Mantenimiento | |
| MT-03 | Ciclo de vida de ticket (OPEN → RESOLVED → VERIFIED) | 📋 | Roadmap P7 | Mantenimiento | |
| MT-04 | Badge "🔧 Mtto pendiente" en DailyPlanningGrid | 📋 | Roadmap P7 | Recepcionista | Comunicación HK ↔ Mantenimiento |
| MT-05 | Foto antes/después de reparación | 📋 | Roadmap P7 | Mantenimiento | S3/Cloudinary upload |

---

### Módulo: Configuración y Administración

| # | Funcionalidad | Estado | Sprint | Rol que lo usa | Notas |
|---|---------------|--------|--------|----------------|-------|
| CFG-01 | Login / autenticación JWT | ✅ | Etapa 1 | Todos | `auth/` módulo |
| CFG-02 | CRUD de habitaciones y camas | ✅ | Etapa 1 | Admin | `rooms/`, `beds/` |
| CFG-03 | CRUD de staff (housekeepers, supervisores, recepcionistas) | ✅ | Etapa 1 | Admin | `staff/` |
| CFG-04 | Configuración de propiedad (timezone, checkout time) | ✅ | Etapa 1 | Admin | `PropertySettings` |
| CFG-05 | Configuración de hora de corte de no-shows (`noShowCutoffHour`) | ✅ | Sprint 5 | Admin | `PropertySettings` |
| CFG-06 | Configuración de outreach automático (`enableAutoOutreach`) | ✅ | Sprint 5/6 | Admin | `PropertySettings` |
| CFG-07 | Configuración de secciones de limpieza (housekeeper → habitaciones) | 📋 | Roadmap P3 | Admin | Auto-asignación |
| CFG-08 | Configuración de checklists por tipo de habitación | 📋 | Roadmap P2 | Admin | |
| CFG-09 | Configuración de rate plans | ⏳ | Sprint 8 | Admin | |

---

### Módulo: Reportes y Métricas

| # | Funcionalidad | Estado | Sprint | Rol que lo usa | Notas |
|---|---------------|--------|--------|----------------|-------|
| RPT-01 | Métricas del día (ocupación, tareas completadas) | ✅ | Etapa 1 | Supervisor | `ReportsPage ?tab=housekeeping` |
| RPT-02 | Reporte de no-shows con export CSV | ✅ | Sprint 5 | Supervisor/Contabilidad | `?tab=noshow` |
| RPT-03 | Historial de checkouts | ✅ | Etapa 1 | Supervisor | `CheckoutsPage` |
| RPT-04 | Discrepancias abiertas | ⚠️ | Etapa 1 | Supervisor | Lista existe, resolución pendiente |
| RPT-05 | Métricas de rendimiento por housekeeper | 📋 | Roadmap P5 | Supervisor | Avg tiempo por habitación y tipo |
| RPT-06 | Benchmarks de mercado por ciudad | 📋 | Sprint 9+ | Admin/Dirección | Data Network Effects |
| RPT-07 | Revenue por canal (OTA vs directo) | ⏳ | Sprint 8 | Dirección | `GET /reports/revenue` |

---

## Estrategia de Documentación y Onboarding

> La documentación se construye de forma incremental. Esta sección define la arquitectura del sistema de documentación — no la documentación en sí. El objetivo final es un módulo de onboarding in-app que cualquier recepcionista nuevo pueda completar en 20 minutos sin asistencia.

### Principios de diseño de la documentación (Nielsen Norman Group, Apple HIG)

1. **Progressive disclosure** — la documentación espeja la complejidad de la UI. El onboarding muestra primero lo que el usuario necesita el día 1; los flujos avanzados se presentan cuando el usuario los busca.
2. **Task-based** — organizar por tarea operativa ("¿Cómo registro la salida de un huésped?"), no por módulo ("Módulo de Housekeeping — sección 3.2").
3. **Mínimo de texto** — consistente con §13 (UX optimizada para la 100ª sesión). El onboarding usa GIFs/videos cortos + texto mínimo. Sin paredes de texto.
4. **Contextual help** — los tooltips de ayuda aparecen solo cuando el usuario lo pide (icono `?`), nunca como overlay permanente.
5. **Flujos, no features** — documentar "cómo hacer X" (flujo), no "qué hace el botón Y" (feature). El botón se entiende del label; el flujo requiere documentación.

### Jerarquía de documentación

```
Nivel 1 — Onboarding in-app (Sprint 10+)
  └── Guías interactivas dentro del propio sistema
  └── Tooltips contextuales al primer uso de cada feature
  └── Video demos de 60s por flujo principal

Nivel 2 — Help center (Sprint 9+)
  └── Base de conocimiento estructurada por rol y tarea
  └── FAQs por módulo
  └── Glosario hotelero (check-in, no-show, folio, etc.)

Nivel 3 — Documentación técnica (continua)
  └── CLAUDE.md (este archivo) — para el equipo de desarrollo
  └── API docs (Swagger) — para integraciones
  └── Guía de configuración inicial — para el propietario del hotel
```

### Bitácora de flujos a documentar (base para Nivel 1 y 2)

Esta tabla es la fuente de verdad para el módulo de onboarding. Cada fila = una pantalla del onboarding o un artículo del help center.

| Flujo | Rol | Complejidad | Prioridad doc | IDs relacionados |
|-------|-----|-------------|---------------|-----------------|
| Planificación matutina de salidas | Recepcionista | Baja | 🔴 Alta | HK-01, HK-02, HK-03 |
| Confirmar salida física del huésped | Recepcionista | Baja | 🔴 Alta | HK-04 |
| Revertir salida por error | Recepcionista | Media | 🟡 Media | HK-05 |
| Cancelar checkout (extensión de estadía) | Recepcionista | Media | 🟡 Media | HK-06 |
| Monitorear progreso de limpieza en tiempo real | Recepcionista/Supervisor | Baja | 🔴 Alta | HK-07 |
| Iniciar y finalizar una tarea de limpieza (mobile) | Housekeeper | Baja | 🔴 Alta | HK-09, HK-10 |
| Crear una reserva nueva desde el calendario | Recepcionista | Media | 🔴 Alta | PMS-01, CI-01, CI-02 |
| Mover una reserva a otra habitación | Recepcionista | Media | 🟡 Media | PMS-03 |
| Extender la estadía de un huésped | Recepcionista | Media | 🟡 Media | PMS-04, PMS-06 |
| Marcar un no-show | Recepcionista | Alta | 🔴 Alta | NS-01 |
| Revertir un no-show | Supervisor | Alta | 🟡 Media | NS-04 |
| Cobrar/perdonar cargo de no-show | Supervisor | Alta | 🟡 Media | NS-12, NS-13 |
| Ver historial completo de una reserva | Recepcionista | Baja | 🟢 Baja | CI-05 |
| Asignar tarea a un housekeeper | Supervisor | Media | 🟡 Media | HK-14 |
| Verificar tarea completada | Supervisor | Baja | 🟡 Media | HK-11 |
| Interpretar el reporte de no-shows | Supervisor/Contabilidad | Media | 🟡 Media | NS-11, RPT-02 |
| Configurar timezone de la propiedad | Admin | Baja | 🟢 Baja | CFG-04 |

### Glosario hotelero (términos que deben aparecer en el onboarding)

| Término | Definición operativa en Zenix |
|---------|------------------------------|
| **Check-out** | El huésped desocupa físicamente la habitación. En Zenix hay dos pasos: planificación AM y confirmación física. |
| **No-show** | Huésped que no llegó en su fecha de check-in y no avisó. Genera un cargo según política de la propiedad. |
| **Stayover** | Huésped que continúa hospedado (no hace check-out hoy). Su habitación también necesita limpieza. |
| **DIRTY** | Estado de cama: el huésped salió y la cama necesita limpieza. |
| **READY** | Estado de tarea: el housekeeper puede ir a limpiar. |
| **PENDING_DEPARTURE** | El huésped todavía no sale físicamente — la tarea existe pero no se activa. |
| **Urgente** | Una cama marcada "🔴 Hoy entra" — hay un nuevo huésped que llega el mismo día. Prioridad máxima. |
| **Night Audit** | Proceso automático al cierre del día: marca no-shows, libera inventario, cierra el corte fiscal. |
| **Folio** | Registro de todos los cargos acumulados de una estadía. |
| **OTA** | Online Travel Agency — Booking.com, Airbnb, Expedia. Las reservas OTA entran por Channex. |
| **Journey** | El recorrido completo de un huésped, incluyendo cambios de habitación y extensiones. |

### Estructura propuesta del módulo de onboarding (Sprint 10+)

```
Onboarding (primera sesión del usuario)
│
├── [Paso 1] ¿Qué rol tienes? → Recepcionista / Housekeeper / Supervisor
│
├── [Camino Recepcionista]
│   ├── Video 60s: "El día de un recepcionista en Zenix"
│   ├── Tutorial interactivo: Planificar salidas del día (sandbox)
│   ├── Tutorial interactivo: Confirmar salida física
│   ├── Tutorial interactivo: Crear una reserva en el calendario
│   └── Completado → badge + acceso a help center contextual
│
├── [Camino Housekeeper]
│   ├── Video 60s: "Cómo usar la app en tu turno"
│   ├── Tutorial interactivo: Ver mis tareas asignadas
│   ├── Tutorial interactivo: Iniciar y finalizar limpieza
│   └── Completado → acceso al turno
│
└── [Camino Supervisor]
    ├── Video 60s: "Vista del supervisor en Zenix"
    ├── Tutorial interactivo: Monitorear el tablero de tareas
    ├── Tutorial interactivo: Verificar limpieza completada
    ├── Tutorial interactivo: Interpretar reportes de no-shows
    └── Completado → acceso a configuración avanzada
```

### Criterios de completitud para el módulo de onboarding

Antes de construir el onboarding (Sprint 10+), deben estar completos:
1. ✅ Flujos de Etapa 1 (Housekeeping) — completos
2. ✅ Flujos PMS básicos (calendario, crear reserva, no-show) — completos
3. ✅ Sprint 7B y 7C — completos
4. ⏳ Sprint 8 (payments, Channex real) — pendiente
5. 📋 KanbanPage completa para supervisores — pendiente
6. 📋 Módulo de Mantenimiento MVP — pendiente

El onboarding se construye cuando los flujos principales estén estables. Construirlo antes genera deuda de documentación (los tutoriales quedan desactualizados con cada cambio de UI).

---

## Arquitectura de Protección contra Overbooking

> Referencia para el speech de ventas y para entender las capas de defensa del sistema.
> El overbooking es el riesgo operativo más costoso de un PMS — una habitación vendida dos veces genera devoluciones, reubicaciones de emergencia y pérdida de reputación.

### Las 3 capas de protección

#### Capa 1 — Hard block transaccional ✅ Activo hoy

Toda operación que crea o modifica una reserva (venga del recepcionista, de un webhook de OTA, o del night audit) pasa obligatoriamente por `checkAvailability` antes de escribir en base de datos.

```
¿Existe una estadía activa en roomId que se superponga con [from, to]
y que NO sea un no-show (noShowAt: null)?
  → Sí → 409 ConflictException — la operación se rechaza
  → No → se confirma la reserva
```

**Quién gana:** el que confirma primero. PostgreSQL garantiza que dos transacciones simultáneas no pueden ambas pasar el check — una de ellas recibirá el conflicto. Esto aplica igualmente a reservas creadas por el recepcionista en Zenix y a webhooks de Channex (reservas de OTAs).

**Consecuencia para el recepcionista:** recibe un mensaje de error con el nombre del huésped que ya ocupa la habitación y sus fechas. No hay overbooking silencioso.

**Archivo clave:** `apps/api/src/pms/guest-stays/guest-stays.service.ts` → `checkAvailability()`

#### Capa 2 — Channel Manager (Channex.io) ⚠️ Sprint 8C

Esta capa cierra el gap de tiempo entre que Zenix confirma una reserva y que las OTAs actualizan su disponibilidad.

```
Recepcionista confirma reserva en Zenix
        ↓
checkAvailability pasa → reserva se guarda en BD
        ↓
AvailabilityService.notifyReservation() [fire-and-forget, fuera de tx]
        ↓
ChannexGateway.pushInventory(roomId, dates, allotment: 0)
        ↓
Channex.io actualiza Booking.com / Hostelworld / Airbnb en segundos
        ↓
La habitación desaparece de la disponibilidad en OTAs
```

Sin Sprint 8C, la Capa 1 sigue atrapando el segundo intento cuando el webhook de la OTA llega. Lo que cambia es **cuántos minutos la habitación aparece como disponible en OTAs antes del webhook**.

**Política ante fallo de Channex:** fail-soft (best-effort). Si la red a Channex falla, la reserva local ya está commiteada — no se revierte. Se loguea para reintento manual. La Capa 1 sigue siendo la defensa final.

**Archivo clave:** `apps/api/src/integrations/channex/channex.gateway.ts` (stub hoy)

#### Capa 3 — SSE Soft-Lock intra-Zenix ✅ Activo (Sprint 7C)

Protege únicamente el caso de dos recepcionistas del mismo hotel abriendo el mismo dialog simultáneamente. No tiene relación con OTAs.

```
Recepcionista A abre CheckInDialog para Hab. 205
        ↓
POST /v1/rooms/205/soft-lock/acquire → badge 🔒 "En uso por María G." para todos
        ↓
Recepcionista B ve el badge → espera o elige otra habitación
        ↓
Recepcionista A confirma → DELETE /v1/rooms/205/soft-lock → badge desaparece
```

**No es un hard block.** Si B ignora el badge e intenta confirmar, la Capa 1 lo rechazará. El soft-lock es UX, no seguridad.

---

### Escenario: recepcionista + Hostelworld simultáneos

```
T=0s   Recepcionista abre dialog → badge 🔒 (Capa 3, solo para otros Zenix users)
T=0s   Huésped en Hostelworld ve habitación disponible

--- Sin Sprint 8C activo ---
T=30s  Recepcionista confirma → BD local OK → Channex no notificado
T=60s  Huésped confirma en Hostelworld → webhook llega a Zenix
T=60s  checkAvailability detecta conflicto → 409 → reserva Hostelworld rechazada ✅
T=60s  Hostelworld marca la reserva como fallida → reintenta con otra hab. o notifica al huésped

--- Con Sprint 8C activo ---
T=30s  Recepcionista confirma → BD local OK → pushInventory a Channex (fire-and-forget)
T=31s  Channex actualiza Hostelworld: allotment = 0
T=32s  Habitación desaparece de Hostelworld
T=60s  Huésped ya no puede confirmar — la habitación no aparece ✅
```

**Resultado en ambos casos:** no hay overbooking. La diferencia es la experiencia del huésped en Hostelworld (error post-confirmación vs. habitación que desaparece antes de que confirme).

---

### Para el speech de ventas

**Hoy (pre-Sprint 8C):**
> "Zenix tiene protección transaccional contra overbooking: toda reserva — venga del recepcionista o de una OTA — pasa por un hard check de disponibilidad antes de confirmarse. El primero que confirma gana. Si Booking.com intenta vender una habitación que ya confirmaste en Zenix, el sistema rechaza automáticamente la segunda reserva."

**Post-Sprint 8C:**
> "Zenix sincroniza el inventario en tiempo real con Channex.io, el mismo estándar de Opera Cloud y Mews. En cuanto confirmas una reserva, la disponibilidad se actualiza en todas tus OTAs — Booking.com, Hostelworld, Airbnb — en segundos. Dos capas de protección: sincronización preventiva en OTAs + hard block transaccional como defensa final."

**Diferenciador de audit trail:**
> "Si una OTA abre una disputa por una reserva rechazada, Zenix tiene el timestamp exacto de cuándo se confirmó la primera reserva, quién la creó, y el error 409 con causa específica. Ningún PMS entry-level tiene ese nivel de trazabilidad."
