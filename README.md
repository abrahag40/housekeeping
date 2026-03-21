# Housekeeping Intelligence

Full-stack housekeeping management app for hotels and hostels. Supports private rooms and shared dorms (bed-level granularity).

## Architecture

```
housekeeping3/
├── apps/
│   ├── api/      # NestJS + Prisma + PostgreSQL
│   ├── web/      # React + Vite (reception + supervisor dashboard)
│   └── mobile/   # Expo React Native (housekeeper app)
└── packages/
    └── shared/   # TypeScript enums + interfaces
```

## Quick Start

### Prerequisites
- Node.js 20+
- Docker + Docker Compose

### Development

```bash
# Install dependencies
npm install

# Start database + API with hot reload
docker-compose -f docker-compose.dev.yml up

# Or run everything locally
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with your values

npm run db:migrate --workspace=@housekeeping/api
npm run db:seed --workspace=@housekeeping/api
npx turbo dev
```

### Production

```bash
docker-compose up -d
```

## Seed Credentials

| Role | Email | Password |
|------|-------|----------|
| Supervisor | supervisor@demo.com | supervisor123 |
| Receptionist | reception@demo.com | reception123 |
| Housekeeper 1 | hk1@demo.com | housekeeper123 |
| Housekeeper 2 | hk2@demo.com | housekeeper123 |

## Environment Variables

```env
# apps/api/.env
DATABASE_URL=postgresql://housekeeping:password@localhost:5432/housekeeping_dev
JWT_SECRET=your-secret-here
JWT_EXPIRES_IN=7d
EXPO_ACCESS_TOKEN=           # Expo push notifications
CLOUDBEDS_WEBHOOK_SECRET=    # HMAC verification
ALLOWED_ORIGINS=http://localhost:5173  # production CORS
PORT=3000
```

## API Reference

Base URL: `http://localhost:3000/api`

### Auth
```
POST /auth/login          { email, password } → { token, user }
```

### Properties
```
GET    /properties
POST   /properties        { name, timezone }
GET    /properties/:id
PATCH  /properties/:id
DELETE /properties/:id
```

### Rooms
```
GET    /properties/:propertyId/rooms
POST   /properties/:propertyId/rooms  { number, type, floor, capacity, cloudbedsRoomId? }
GET    /rooms/:id
PATCH  /rooms/:id
DELETE /rooms/:id
```

### Beds
```
GET    /rooms/:roomId/beds
POST   /rooms/:roomId/beds    { label, position? }
GET    /beds/:id
PATCH  /beds/:id
DELETE /beds/:id
```

### Staff
```
GET    /staff
POST   /staff              { name, email, password, role, capabilities[] }
GET    /staff/:id
PATCH  /staff/:id
DELETE /staff/:id          # soft delete (sets active=false)
```

### Tasks
```
GET    /tasks              ?status=&assignedToId=&bedId=&roomId=
POST   /tasks              { bedId, taskType, priority?, assignedToId?, notes? }
GET    /tasks/:id
PATCH  /tasks/:id/assign   { staffId }
PATCH  /tasks/:id/start
PATCH  /tasks/:id/pause
PATCH  /tasks/:id/resume
PATCH  /tasks/:id/end
PATCH  /tasks/:id/verify
```

### Checkouts
```
POST   /checkouts          { roomId, guestName?, actualCheckoutAt, isEarlyCheckout?, hasSameDayCheckIn?, notes? }
POST   /checkouts/batch    { beds: [{ bedId, hasSameDayCheckIn? }][], date, notes? }
GET    /checkouts          ?roomId=&date=
PATCH  /checkouts/:id/cancel
GET    /planning/daily     ?date=&propertyId=   → DailyPlanningGrid
```

### Notes & Issues
```
POST   /tasks/:id/notes    { content }
GET    /tasks/:id/notes
POST   /tasks/:id/issues   { category, description, photoUrl? }
GET    /tasks/:id/issues
```

### Notifications
```
POST   /notifications/token   { token, platform }   # register Expo push token
GET    /events                                       # SSE stream
```

### Webhooks (public)
```
POST   /webhooks/cloudbeds    # CloudBeds reservation events (HMAC verified)
```

## Task State Machine

```
PENDING → READY (checkout confirmed, housekeeper assigned)
        → UNASSIGNED (checkout confirmed, no housekeeper)

UNASSIGNED → READY (supervisor assigns)

READY → IN_PROGRESS (housekeeper starts)

IN_PROGRESS → PAUSED
            → DONE (housekeeper finishes)

PAUSED → IN_PROGRESS

DONE → VERIFIED (supervisor/reception)

READY | IN_PROGRESS | PAUSED → CANCELLED (stay extension)
```

## Role Permissions

| Action | HOUSEKEEPER | SUPERVISOR | RECEPTIONIST |
|--------|:-----------:|:----------:|:------------:|
| View own tasks | ✅ | ✅ | — |
| Start/End own task | ✅ | ✅ | — |
| Start/End any task | — | ✅ | — |
| Verify task | — | ✅ | ✅ |
| Manual checkout | — | ✅ | ✅ |
| Daily planning | — | ✅ | ✅ |
| Assign staff | — | ✅ | — |
| View rooms dashboard | — | ✅ | ✅ |
| Manage staff | — | ✅ | — |
| Report maintenance | ✅ | ✅ | — |

## Operational Flow

1. **Morning planning** — Reception opens `/planning`, marks each bed: Vacía / Ocupado / Salida / Salida+Entrada → clicks "Confirm" → batch creates all Checkouts + CleaningTasks
2. **Priority** — Beds with Salida+Entrada (same-day check-in) get `URGENT` priority, appear first in housekeeper's list with 🔴 badge
3. **Notification** — Housekeepers receive Expo push notification per assigned room
4. **Cleaning** — Housekeeper opens mobile app → taps START → cleans → adds optional notes → taps DONE
5. **Reception notified** — SSE event updates room card to green in real-time; notes shown with amber badge
6. **Verification** — Supervisor/Reception verifies → status VERIFIED
7. **Stay extension** — Reception changes "Salida" → "Ocupado" in grid → READY/UNASSIGNED tasks auto-cancelled, IN_PROGRESS tasks trigger supervisor alert

## CI

GitHub Actions runs on every PR to `main`:
- Lint (`turbo lint`)
- Tests (`turbo test`) with PostgreSQL service container
- Prisma migrate deploy
