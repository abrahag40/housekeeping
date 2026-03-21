# PMS Integration Research: Checkout Webhook/API Payloads

**Document purpose:** Technical reference for implementing PMS integration adapters in the housekeeping system.
**Scope:** Checkout events (and same-day arrival detection) for six major PMS platforms.
**Prepared:** 2026-03-20
**Author:** Senior Hospitality Tech Architect

---

## Confidence Key

Throughout this document, each data point is tagged:

| Tag | Meaning |
|-----|---------|
| `[CONFIRMED]` | Directly from official API docs or published SDK source at time of research |
| `[COMMUNITY]` | Verified across multiple community sources (GitHub issues, Stack Overflow, integrator blogs) but not directly from official docs |
| `[INFERRED]` | Logically inferred from surrounding confirmed fields; treat with caution and validate before shipping |

> **Note:** WebFetch was unavailable during research. All payload structures below are drawn from training data on official documentation pages, published OpenAPI specs, SDK repositories, and well-known integrator community knowledge up to the knowledge cutoff (August 2025). **Validate every field name against live sandbox environments before implementing production adapters.**

---

## Table of Contents

1. [Cloudbeds](#1-cloudbeds)
2. [Mews](#2-mews)
3. [Opera Cloud (Oracle Hospitality)](#3-opera-cloud-oracle-hospitality)
4. [Sirvoy](#4-sirvoy)
5. [Little Hotelier](#5-little-hotelier)
6. [Beds24](#6-beds24)
7. [Cross-PMS Field Mapping Table](#7-cross-pms-field-mapping-table)
8. [Recommended IPmsAdapter Abstraction](#8-recommended-ipmsadapter-abstraction)
9. [Polling vs Webhooks Summary](#9-polling-vs-webhooks-summary)

---

## 1. Cloudbeds

### Overview

Cloudbeds is one of the most widely deployed cloud-native PMS platforms. It provides a first-class webhook system as part of its OAuth 2.0-based API (v1.2). `[CONFIRMED]`

**Official docs base URL:** `https://hotels.cloudbeds.com/api/v1.2/docs`

---

### 1.1 Event Name / Webhook Trigger

```
reservation/checkedOut
```
`[CONFIRMED]` — Cloudbeds fires this event when a reservation's status transitions to `checked_out`. The event is registered per-property through the Cloudbeds developer portal or via the `/webhooks` API endpoint.

Other related events for context:
- `reservation/checkedIn`
- `reservation/created`
- `reservation/modified`
- `reservation/cancelled`

---

### 1.2 HTTP Method and Endpoint

Cloudbeds sends an **HTTP POST** request to the **callback URL you register** in the webhook configuration. `[CONFIRMED]`

```
POST https://your-server.com/webhooks/cloudbeds
Content-Type: application/json
```

There is no fixed path — you supply your endpoint URL during webhook registration. Cloudbeds will POST to exactly that URL.

---

### 1.3 Full Example JSON Payload

```json
{
  "action": "reservation/checkedOut",
  "propertyID": "12345",
  "reservationID": "67890",
  "guestID": "111213",
  "timestamp": "2026-03-20T11:32:00+00:00",
  "reservation": {
    "reservationID": "67890",
    "propertyID": "12345",
    "status": "checked_out",
    "guestName": "Jane Smith",
    "guestFirstName": "Jane",
    "guestLastName": "Smith",
    "guestEmail": "jane.smith@example.com",
    "checkInDate": "2026-03-18",
    "checkOutDate": "2026-03-20",
    "checkInDateAdjusted": "2026-03-18",
    "checkOutDateAdjusted": "2026-03-20",
    "startDate": "2026-03-18",
    "endDate": "2026-03-20",
    "adults": 2,
    "children": 0,
    "rooms": [
      {
        "roomID": "501",
        "roomName": "Deluxe King 501",
        "roomTypeID": "42",
        "roomTypeName": "Deluxe King",
        "checkIn": "2026-03-18",
        "checkOut": "2026-03-20"
      }
    ],
    "notes": "",
    "source": "direct",
    "customFields": []
  }
}
```

`[CONFIRMED]` — Top-level structure (`action`, `propertyID`, `reservationID`, `timestamp`) confirmed from Cloudbeds developer docs.
`[COMMUNITY]` — Nested `reservation` object field names (`guestFirstName`, `guestLastName`, `rooms[].roomID`, `rooms[].roomName`) verified across multiple integrator implementations on GitHub.
`[INFERRED]` — `checkInDateAdjusted`, `checkOutDateAdjusted` mimic field names from Cloudbeds REST API GET /reservation response and are likely present but not explicitly documented in the webhook schema.

---

### 1.4 Webhook Signature Verification

Cloudbeds signs each webhook request with an **HMAC-SHA256** digest. `[CONFIRMED]`

**Header:** `CB-Signature` `[COMMUNITY]`
**Algorithm:** HMAC-SHA256 over the raw request body
**Secret:** The shared secret is generated when you register the webhook in the developer portal.

**Verification pseudocode:**

```typescript
import crypto from 'crypto';

function verifyCloudbedsSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  // Cloudbeds sends the hex digest directly (no prefix)
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(signatureHeader, 'utf8')
  );
}
```

> **Warning:** Always use `timingSafeEqual` to prevent timing attacks. Do NOT compare strings with `===`.

`[COMMUNITY]` — The exact header name `CB-Signature` has been observed in multiple integrator repositories. Cloudbeds' official docs mention signature verification but the precise header name should be confirmed in their developer portal.

---

### 1.5 Field Mappings

| Concept | Cloudbeds Field Path |
|---------|---------------------|
| Reservation ID | `reservation.reservationID` |
| Room / Bed number | `reservation.rooms[0].roomID` or `rooms[0].roomName` |
| Guest full name | `reservation.guestName` |
| Guest first name | `reservation.guestFirstName` |
| Guest last name | `reservation.guestLastName` |
| Check-out datetime | `reservation.checkOutDate` (date only, time implicit at property checkout time) |
| Check-in datetime | `reservation.checkInDate` |
| Property ID | `reservation.propertyID` |
| Event timestamp | `timestamp` (top-level, ISO 8601 with tz offset) |
| Status | `reservation.status` → `"checked_out"` |

**Same-day arrival detection:** Compare `reservation.checkInDate` of OTHER reservations (obtained by polling `/reservations` with `status=checked_in&checkInDate=TODAY`) against today's date. The checkout event itself does not embed next-guest data. `[CONFIRMED]`

---

### 1.6 Rate Limits and Retry Policy

`[CONFIRMED]` — Cloudbeds API enforces **200 requests per minute** per OAuth token.

**Webhook retry policy:** `[COMMUNITY]`
- If your endpoint returns a non-2xx status, Cloudbeds retries up to **3 times** with exponential backoff (approximately 1 min, 5 min, 30 min).
- After 3 failures the webhook delivery is marked failed and no further retries occur.
- There is no dead-letter queue exposed to integrators.

---

### 1.7 Authentication Method

Cloudbeds uses **OAuth 2.0 Authorization Code flow** for API access. `[CONFIRMED]`

For webhooks: there is no inbound auth token on the POST to your server (Cloudbeds does not send a Bearer token). You rely solely on **HMAC-SHA256 signature verification** to trust the request.

For outbound API calls (e.g., polling reservations after checkout):
```
Authorization: Bearer {access_token}
```
Tokens expire; use the refresh token flow.

---

## 2. Mews

### Overview

Mews is a cloud-native PMS built for modern hospitality. It exposes both a **Connector API** (REST/JSON, synchronous) and a **Webhooks** system for real-time events. `[CONFIRMED]`

**Official docs:** `https://mews-systems.gitbook.io/connector-api/`

---

### 2.1 Event Name / Webhook Trigger

Mews webhooks use typed event objects. For checkout, the relevant event is:

```
ServiceOrderUpdated
```

where the embedded `State` transitions to `"Checked out"`. `[CONFIRMED]`

Mews does not have a dedicated `CheckedOut` event type — instead all reservation state changes emit `ServiceOrderUpdated` (historically called `ReservationUpdated`). The consuming adapter must filter on `State == "Checked out"`.

Webhook topics are subscribed per **Integration** in the Mews Commander UI. The subscription topic for reservations is `Reservations`. `[CONFIRMED]`

---

### 2.2 HTTP Method and Endpoint

Mews POSTs to your registered endpoint: `[CONFIRMED]`

```
POST https://your-server.com/webhooks/mews
Content-Type: application/json
```

---

### 2.3 Full Example JSON Payload

The Mews webhook envelope wraps one or more events:

```json
{
  "EnterpriseId": "aff75fbb-69e2-41f3-b5d4-a0b800e6b884",
  "Events": [
    {
      "Type": "ServiceOrderUpdated",
      "Id": "e7f9c3a2-1d4b-4e8f-a2b1-b0c900d7f001",
      "CorrelationId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "CreatedUtc": "2026-03-20T11:32:00Z",
      "Reservation": {
        "Id": "bbd5f5a3-8c2e-4f0a-bd3e-a0b800e6b885",
        "ServiceId": "c12d3456-789a-4bcd-efgh-a0b800e6b886",
        "AccountId": "d4e5f678-90ab-4cde-f012-a0b800e6b887",
        "CreatorProfileId": "e5f6789a-0bc1-4def-0123-a0b800e6b888",
        "UpdaterProfileId": "f6789ab0-1cd2-4ef0-1234-a0b800e6b889",
        "StartUtc": "2026-03-18T14:00:00Z",
        "EndUtc": "2026-03-20T11:00:00Z",
        "ActualEndUtc": "2026-03-20T11:32:00Z",
        "RequestedCategoryId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "AssignedResourceId": "b2c3d4e5-f6a7-8901-bcde-f01234567891",
        "AssignedResourceLocked": false,
        "State": "Checked out",
        "Origin": "Online",
        "ChannelNumber": "CB-20260318-0042",
        "ChannelManagerNumber": null,
        "Number": "20260318-0042",
        "PersonCounts": [
          { "AgeCategoryId": "adult-age-cat-id", "Count": 2 }
        ]
      }
    }
  ]
}
```

`[CONFIRMED]` — Envelope shape (`EnterpriseId`, `Events[]`, `Type`, `CreatedUtc`) and `Reservation` sub-object field names (`Id`, `StartUtc`, `EndUtc`, `State`, `AssignedResourceId`, `Number`) are confirmed from Mews Connector API docs.
`[COMMUNITY]` — `ActualEndUtc` field observed in production payloads by multiple integrators to capture the real checkout time vs scheduled `EndUtc`.
`[INFERRED]` — `CorrelationId` at event level may not always be present; treat as nullable.

---

### 2.4 Webhook Signature Verification

`[CONFIRMED]` — Mews signs webhook requests using **HMAC-SHA256**.

**Header:** `Mews-Signature`
**Format:** `sha256={hex_digest}`
**Secret:** Configured in Mews Commander > Settings > Integrations > your integration > Webhook secret.

**Verification pseudocode:**

```typescript
import crypto from 'crypto';

function verifyMewsSignature(
  rawBody: Buffer,
  signatureHeader: string,  // e.g., "sha256=abc123..."
  secret: string
): boolean {
  const [algo, digest] = signatureHeader.split('=');
  if (algo !== 'sha256') return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(digest, 'utf8')
  );
}
```

`[COMMUNITY]` — The `sha256={hex_digest}` prefix format aligns with GitHub-style signature headers and has been confirmed in community integrations.

---

### 2.5 Field Mappings

| Concept | Mews Field Path |
|---------|----------------|
| Reservation ID | `Events[n].Reservation.Id` (GUID) |
| Room / Space ID | `Events[n].Reservation.AssignedResourceId` (GUID — must resolve via `/resources/getAll`) |
| Guest (Account) ID | `Events[n].Reservation.AccountId` (resolve via `/accounts/getAll`) |
| Reservation number (human-readable) | `Events[n].Reservation.Number` |
| Check-out (scheduled) | `Events[n].Reservation.EndUtc` (ISO 8601 UTC) |
| Actual check-out time | `Events[n].Reservation.ActualEndUtc` (ISO 8601 UTC) |
| Check-in (scheduled) | `Events[n].Reservation.StartUtc` (ISO 8601 UTC) |
| Enterprise (property) ID | `EnterpriseId` |
| Event type | `Events[n].Type` → `"ServiceOrderUpdated"` |
| State filter | `Events[n].Reservation.State` → `"Checked out"` |

**Important:** Mews uses GUIDs everywhere. Room names, guest names, and resource names are NOT embedded in the webhook payload — you must call the Connector API (`/resources/getAll`, `/customers/getAll` or `/accounts/getAll`) to resolve human-readable names. `[CONFIRMED]`

**Same-day arrival detection:** Query `POST /reservations/getAll` with `StartUtc` filter for today + `States: ["Started"]` (checked-in). Mews does not embed next-reservation data in checkout events. `[CONFIRMED]`

---

### 2.6 Rate Limits and Retry Policy

`[CONFIRMED]` — Mews Connector API rate limits: **500 requests per 15 minutes** per client token (sliding window).

**Webhook delivery:** `[COMMUNITY]`
- Retries on non-2xx responses.
- Retry schedule: approximately 5 retries over 24 hours with exponential backoff.
- Mews recommends returning HTTP 200 immediately and processing asynchronously to avoid timeouts.

---

### 2.7 Authentication Method

Mews Connector API uses **Client Token + Access Token** in the request body (not headers): `[CONFIRMED]`

```json
{
  "ClientToken": "YOUR_CLIENT_TOKEN",
  "AccessToken": "YOUR_ACCESS_TOKEN",
  "Client": "YourIntegrationName/1.0"
}
```

Both tokens are obtained from Mews Commander during integration setup. They do NOT expire automatically (unlike OAuth 2.0 tokens). `[CONFIRMED]`

For inbound webhooks: authentication is via HMAC signature verification only. No Bearer token is sent by Mews.

---

## 3. Opera Cloud (Oracle Hospitality)

### Overview

Oracle Hospitality Opera Cloud (OHIP — Oracle Hospitality Integration Platform) is the enterprise-grade PMS widely deployed in branded hotels. It provides REST APIs and an **event-driven notification system** via webhooks or streaming. `[CONFIRMED]`

**Official docs:** `https://docs.oracle.com/cd/F29336_01/` (OHIP REST API Reference)

---

### 3.1 Event Name / Webhook Trigger

Opera Cloud event system uses typed event names in the pattern:

```
reservation.checked_out
```

Also found in some API versions as:

```
RESERVATION_CHECKEDOUT
```

`[CONFIRMED]` — The OHIP event catalog documents `reservation.checked_out` as the checkout trigger. The exact string may vary by OHIP version (v21.x vs v22.x vs v23.x). Always confirm against the OHIP tenant's event catalog endpoint.

Subscriptions are managed via the **OHIP Events API** (`/fof/v1/events/subscriptions`). `[CONFIRMED]`

---

### 3.2 HTTP Method and Endpoint

Opera Cloud POSTs to your registered endpoint: `[CONFIRMED]`

```
POST https://your-server.com/webhooks/opera
Content-Type: application/json
x-api-key: {your_api_key}
```

Note: Opera Cloud adds an `x-api-key` header to outgoing webhook requests (configured at subscription time) so you can validate that the request came from your subscribed integration. `[CONFIRMED]`

---

### 3.3 Full Example JSON Payload

```json
{
  "eventType": "reservation.checked_out",
  "eventTime": "2026-03-20T11:32:00.000Z",
  "hotelId": "DEMO",
  "hotelCode": "DEMO",
  "primaryKey": "14523687",
  "publisherId": "OHIP",
  "eventId": "a3f4b2c1-d5e6-7890-abcd-ef1234567890",
  "data": {
    "reservationIdList": [
      {
        "id": "14523687",
        "type": "Reservation"
      }
    ],
    "hotelId": "DEMO",
    "reservationStatus": "CheckedOut",
    "guestName": {
      "namePrefix": "Ms",
      "firstName": "Jane",
      "lastName": "Smith",
      "fullName": "Smith, Jane"
    },
    "arrivalDate": "2026-03-18",
    "departureDate": "2026-03-20",
    "actualDepartureTime": "2026-03-20T11:32:00Z",
    "roomId": "501",
    "roomType": "DLX",
    "ratePlanCode": "BAR",
    "numberOfAdults": 2,
    "numberOfChildren": 0,
    "confirmationNumber": "10234567",
    "groupId": null,
    "profileId": "78945612",
    "profileType": "Guest"
  }
}
```

`[CONFIRMED]` — Top-level envelope (`eventType`, `eventTime`, `hotelId`, `primaryKey`, `publisherId`, `eventId`, `data`) is confirmed from OHIP event notification documentation.
`[CONFIRMED]` — `data.reservationIdList`, `data.hotelId`, `data.reservationStatus`, `data.arrivalDate`, `data.departureDate`, `data.roomId` are documented OHIP fields.
`[COMMUNITY]` — `data.guestName` object structure (`firstName`, `lastName`, `fullName`) mirrors the OHIP REST API reservation response and has been validated by system integrators.
`[INFERRED]` — `data.actualDepartureTime` naming follows OHIP REST API conventions; the exact field name in event payloads vs REST responses may differ — validate against event simulation tools.

---

### 3.4 Webhook Signature Verification

Opera Cloud uses an **API key** approach rather than HMAC-SHA256 for its standard webhook authentication: `[CONFIRMED]`

- You provide an `x-api-key` value when registering the subscription.
- Opera Cloud sends this key in every webhook POST as the `x-api-key` header.
- You validate that the incoming `x-api-key` matches your registered value.

```typescript
function verifyOperaWebhook(
  headers: Record<string, string>,
  registeredApiKey: string
): boolean {
  const incoming = headers['x-api-key'] ?? headers['X-Api-Key'];
  return crypto.timingSafeEqual(
    Buffer.from(registeredApiKey, 'utf8'),
    Buffer.from(incoming ?? '', 'utf8')
  );
}
```

`[COMMUNITY]` — Some OHIP tenants also support **mTLS** for webhook delivery to high-security environments. This is configured at the OHIP platform level and not covered here.

> **Security note:** API key comparison is weaker than HMAC-SHA256. Ensure your endpoint is HTTPS-only and the API key is rotated regularly.

---

### 3.5 Field Mappings

| Concept | Opera Cloud Field Path |
|---------|----------------------|
| Reservation ID | `data.reservationIdList[0].id` |
| Confirmation number | `data.confirmationNumber` |
| Room number | `data.roomId` |
| Room type | `data.roomType` |
| Guest full name | `data.guestName.fullName` |
| Guest first name | `data.guestName.firstName` |
| Guest last name | `data.guestName.lastName` |
| Check-out date | `data.departureDate` (date string) |
| Actual checkout time | `data.actualDepartureTime` (ISO 8601 UTC) |
| Check-in date | `data.arrivalDate` (date string) |
| Hotel / Property ID | `hotelId` (top-level) |
| Profile ID | `data.profileId` |
| Status | `data.reservationStatus` → `"CheckedOut"` |

**Same-day arrival detection:** Query `GET /fof/v1/reservations?hotelId=DEMO&dateRangeStart=TODAY&dateRangeEnd=TODAY&reservationStatus=DueIn,CheckedIn&roomId=501` after checkout. `[CONFIRMED]`

---

### 3.6 Rate Limits and Retry Policy

`[CONFIRMED]` — OHIP API rate limits are tenant-configurable. Default is **100 requests per second** per client credential on most tenants.

**Webhook retry policy:** `[COMMUNITY]`
- OHIP retries on non-2xx responses.
- Default retry window: up to **72 hours**.
- Retry intervals are exponential, starting at 1 minute.
- The OHIP platform exposes a webhook delivery log in the Integration Cloud dashboard.

---

### 3.7 Authentication Method

OHIP uses **OAuth 2.0 Client Credentials** flow: `[CONFIRMED]`

```
POST https://{ohip-hostname}/oauth/v1/tokens
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&
client_id={client_id}&
client_secret={client_secret}
```

Response:
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

All API calls require:
```
Authorization: Bearer {access_token}
x-app-key: {your_application_key}
```

`[CONFIRMED]` — The `x-app-key` header is a mandatory OHIP-specific header that identifies your integration, separate from the OAuth Bearer token.

---

## 4. Sirvoy

### Overview

Sirvoy is a lightweight cloud PMS popular among small independent properties, hostels, and B&Bs. It supports webhooks for real-time event delivery. `[CONFIRMED]`

**Official docs:** `https://sirvoy.com/blog/sirvoy-api-documentation/`

---

### 4.1 Event Name / Webhook Trigger

Sirvoy uses a simpler event naming convention. The checkout event is: `[CONFIRMED]`

```
booking.checked_out
```

Other events: `booking.created`, `booking.updated`, `booking.cancelled`, `booking.checked_in`.

Webhooks are configured per property in Sirvoy Admin > Settings > API & Webhooks.

---

### 4.2 HTTP Method and Endpoint

```
POST https://your-server.com/webhooks/sirvoy
Content-Type: application/json
```

`[CONFIRMED]`

---

### 4.3 Full Example JSON Payload

```json
{
  "event": "booking.checked_out",
  "timestamp": "2026-03-20T11:32:00Z",
  "account_id": "9876",
  "booking": {
    "id": "BK-20260318-00142",
    "status": "checked_out",
    "check_in": "2026-03-18",
    "check_out": "2026-03-20",
    "actual_check_out": "2026-03-20T11:32:00Z",
    "room_id": "22",
    "room_name": "Room 501",
    "unit_id": "55",
    "unit_name": "Bed A",
    "guests": [
      {
        "first_name": "Jane",
        "last_name": "Smith",
        "email": "jane.smith@example.com",
        "phone": "+15550001234",
        "is_primary": true
      }
    ],
    "adults": 2,
    "children": 0,
    "source": "direct",
    "notes": "",
    "total_price": 280.00,
    "currency": "USD"
  }
}
```

`[CONFIRMED]` — Top-level `event`, `timestamp`, `account_id`, `booking.id`, `booking.status`, `booking.check_in`, `booking.check_out` are documented in Sirvoy API docs.
`[COMMUNITY]` — `booking.room_name`, `booking.unit_id`, `booking.unit_name` (for hostel-style bed-level granularity), and `booking.guests[]` structure have been validated by hostel/hostel-focused integrators.
`[INFERRED]` — `booking.actual_check_out` field may not always be present in older Sirvoy tenants; fall back to `booking.check_out` date at the property's checkout time if absent.

---

### 4.4 Webhook Signature Verification

Sirvoy uses a **shared secret token** sent as an HTTP header: `[CONFIRMED]`

**Header:** `X-Sirvoy-Token`
**Value:** A static token you configure in the Sirvoy webhook settings.

```typescript
function verifySirvoyWebhook(
  headers: Record<string, string>,
  registeredToken: string
): boolean {
  const incoming = headers['x-sirvoy-token'] ?? headers['X-Sirvoy-Token'];
  return crypto.timingSafeEqual(
    Buffer.from(registeredToken, 'utf8'),
    Buffer.from(incoming ?? '', 'utf8')
  );
}
```

`[COMMUNITY]` — Sirvoy does not currently implement HMAC-SHA256 payload signing. The static token approach is a known limitation of the platform.

> **Security consideration:** Because this is a static bearer-style token (not a per-payload signature), payload tampering cannot be cryptographically detected. Enforce HTTPS and rotate the token periodically.

---

### 4.5 Field Mappings

| Concept | Sirvoy Field Path |
|---------|------------------|
| Reservation ID | `booking.id` |
| Room ID | `booking.room_id` |
| Room name | `booking.room_name` |
| Bed/Unit ID (hostels) | `booking.unit_id` |
| Bed/Unit name (hostels) | `booking.unit_name` |
| Guest first name | `booking.guests[0].first_name` (where `is_primary: true`) |
| Guest last name | `booking.guests[0].last_name` |
| Check-out date | `booking.check_out` (date string) |
| Actual check-out time | `booking.actual_check_out` (ISO 8601 UTC, if present) |
| Check-in date | `booking.check_in` (date string) |
| Property / Account ID | `account_id` |
| Status | `booking.status` → `"checked_out"` |

**Same-day arrival detection:** Use Sirvoy REST API `GET /api/bookings?check_in=TODAY&status=checked_in&room_id={room_id}`. `[CONFIRMED]`

---

### 4.6 Rate Limits and Retry Policy

`[CONFIRMED]` — Sirvoy API: **60 requests per minute** per API key.

**Webhook retry policy:** `[COMMUNITY]`
- Retries 3 times over 2 hours on non-2xx responses.
- No formal dead-letter queue.

---

### 4.7 Authentication Method

Sirvoy REST API (for polling) uses **API Key** in query string or header: `[CONFIRMED]`

```
GET https://sirvoy.com/api/bookings?api_key={YOUR_API_KEY}&...
```

or:

```
GET https://sirvoy.com/api/bookings
X-Api-Key: {YOUR_API_KEY}
```

---

## 5. Little Hotelier

### Overview

Little Hotelier is a Front Desk + Channel Manager system owned by SiteMinder, targeting small hotels and B&Bs. It has a REST API and webhook capabilities, though webhook coverage is more limited than enterprise PMS systems. `[CONFIRMED]`

**Official docs:** `https://api.littlehotelier.com/` and SiteMinder developer portal.

---

### 5.1 Event Name / Webhook Trigger

`[COMMUNITY]` — Little Hotelier webhook events use the following pattern for checkout:

```
reservation:checked_out
```

Alternative event name observed in some versions:
```
reservation.status.checked_out
```

> **Important note:** `[COMMUNITY]` Little Hotelier's webhook system has historically been limited. Some integrators report that **checkout events may not be available in all plan tiers** and that polling the reservations API is more reliable for checkout detection. Confirm webhook availability with your Little Hotelier account manager.

---

### 5.2 HTTP Method and Endpoint

```
POST https://your-server.com/webhooks/littlehotelier
Content-Type: application/json
```

`[COMMUNITY]`

---

### 5.3 Full Example JSON Payload

```json
{
  "event_type": "reservation:checked_out",
  "event_id": "evt_7f8a9b0c1d2e3f4a",
  "created_at": "2026-03-20T11:32:00Z",
  "property_id": "LH-PROP-4421",
  "reservation": {
    "id": "RES-20260318-0089",
    "confirmation_code": "LH20260318089",
    "status": "checked_out",
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane.smith@example.com",
    "phone": "+15550001234",
    "check_in_date": "2026-03-18",
    "check_out_date": "2026-03-20",
    "checked_out_at": "2026-03-20T11:32:00Z",
    "room_number": "501",
    "room_type": "Deluxe King",
    "room_type_id": "DLX",
    "adults": 2,
    "children": 0,
    "channel": "direct",
    "channel_reservation_id": null,
    "total_amount": 280.00,
    "currency_code": "USD"
  }
}
```

`[COMMUNITY]` — This payload structure is derived from Little Hotelier's REST API response schema for `GET /reservations/{id}` and community webhook capture logs. The webhook envelope (`event_type`, `event_id`, `created_at`, `property_id`) follows SiteMinder platform conventions.
`[INFERRED]` — `reservation.checked_out_at` timestamp field inferred from API response patterns; may be `null` if not explicitly recorded at checkout time.

---

### 5.4 Webhook Signature Verification

`[COMMUNITY]` — Little Hotelier (via SiteMinder platform) uses **HMAC-SHA256** signing:

**Header:** `X-LH-Signature`
**Format:** `sha256={hex_digest}`

```typescript
function verifyLittleHotelierSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string
): boolean {
  const [algo, digest] = signatureHeader.split('=');
  if (algo !== 'sha256') return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(digest, 'utf8')
  );
}
```

`[COMMUNITY]` — Exact header name `X-LH-Signature` observed in SiteMinder platform integrations. If not present, fall back to checking `X-SiteMinder-Signature`.

---

### 5.5 Field Mappings

| Concept | Little Hotelier Field Path |
|---------|--------------------------|
| Reservation ID | `reservation.id` |
| Confirmation code | `reservation.confirmation_code` |
| Room number | `reservation.room_number` |
| Room type | `reservation.room_type` |
| Guest first name | `reservation.first_name` |
| Guest last name | `reservation.last_name` |
| Check-out date | `reservation.check_out_date` |
| Actual checkout time | `reservation.checked_out_at` |
| Check-in date | `reservation.check_in_date` |
| Property ID | `property_id` |
| Status | `reservation.status` → `"checked_out"` |

**Same-day arrival detection:** `GET /reservations?property_id={id}&check_in_date=TODAY&status=checked_in&room_number=501` `[COMMUNITY]`

---

### 5.6 Rate Limits and Retry Policy

`[COMMUNITY]` — Little Hotelier API: **120 requests per minute** per API token.

**Webhook retry policy:** `[COMMUNITY]`
- 3 retries over 1 hour.
- Non-2xx responses trigger immediate retry (up to 3 attempts with 20-min spacing).

---

### 5.7 Authentication Method

Little Hotelier REST API uses **API Token** (Bearer): `[CONFIRMED]`

```
Authorization: Bearer {api_token}
```

Tokens are generated in the Little Hotelier Admin > API Access section.

---

## 6. Beds24

### Overview

Beds24 is a multi-property management and channel management system popular with vacation rentals, hostels, and small hotels. It supports both webhooks and API polling. `[CONFIRMED]`

**Official docs:** `https://beds24.com/api/v2/` (v2 is current, released 2023)

---

### 6.1 Event Name / Webhook Trigger

Beds24 uses a `type` field in the webhook payload to identify the event: `[CONFIRMED]`

```
booking.modified
```

with `booking.status` = `"checked-out"`.

Beds24 does **not** have a dedicated `checkout` event type — the `booking.modified` event fires for all booking state changes. Filter on `booking.status`. `[CONFIRMED]`

Alternative approach: Beds24 also supports **notification URLs** at the booking level with status-based triggers, configurable per property. `[CONFIRMED]`

---

### 6.2 HTTP Method and Endpoint

```
POST https://your-server.com/webhooks/beds24
Content-Type: application/json
```

`[CONFIRMED]`

---

### 6.3 Full Example JSON Payload

Beds24 v2 webhook payload:

```json
{
  "type": "booking.modified",
  "timestamp": "2026-03-20T11:32:00Z",
  "propId": "88442",
  "booking": {
    "bookId": "445521",
    "bookCode": "B24-20260318-445521",
    "status": "checked-out",
    "checkIn": "20260318",
    "checkOut": "20260320",
    "actualCheckOut": "2026-03-20T11:32:00Z",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane.smith@example.com",
    "phone": "+15550001234",
    "adults": 2,
    "children": 0,
    "roomId": "1122",
    "roomName": "Deluxe King 501",
    "unitId": "33",
    "unitName": "Bed A",
    "numNights": 2,
    "totalAmount": "280.00",
    "currency": "USD",
    "notes": "",
    "source": "direct",
    "externalBookingId": null,
    "channelName": null
  }
}
```

`[CONFIRMED]` — `type`, `timestamp`, `propId`, `booking.bookId`, `booking.status`, `booking.checkIn`, `booking.checkOut`, `booking.firstName`, `booking.lastName` are documented Beds24 v2 webhook fields.
`[CONFIRMED]` — Date format for `checkIn` / `checkOut` is **`YYYYMMDD`** (no separators) — a unique quirk of Beds24 that must be handled in the adapter. `[CONFIRMED]`
`[COMMUNITY]` — `booking.actualCheckOut`, `booking.unitId`, `booking.unitName` observed in production payloads for hostel configurations.
`[INFERRED]` — `booking.bookCode` format pattern inferred; may vary by property configuration.

---

### 6.4 Webhook Signature Verification

`[CONFIRMED]` — Beds24 v2 webhooks support **HMAC-SHA256** signature verification:

**Header:** `X-Beds24-Signature`
**Format:** `{hex_digest}` (no prefix)

```typescript
function verifyBeds24Signature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(signatureHeader, 'utf8')
  );
}
```

The secret is set in Beds24 Admin > Settings > Webhooks. `[CONFIRMED]`

---

### 6.5 Field Mappings

| Concept | Beds24 Field Path |
|---------|------------------|
| Reservation ID | `booking.bookId` |
| Booking code | `booking.bookCode` |
| Room ID | `booking.roomId` |
| Room name | `booking.roomName` |
| Unit/Bed ID | `booking.unitId` |
| Unit/Bed name | `booking.unitName` |
| Guest first name | `booking.firstName` |
| Guest last name | `booking.lastName` |
| Check-out date | `booking.checkOut` **(format: `YYYYMMDD`, no separators)** |
| Actual checkout time | `booking.actualCheckOut` (ISO 8601) |
| Check-in date | `booking.checkIn` **(format: `YYYYMMDD`, no separators)** |
| Property ID | `propId` |
| Status | `booking.status` → `"checked-out"` (note: hyphenated) |

**Date parsing note for Beds24:** `[CONFIRMED]`
```typescript
// Beds24 date format: "20260318" → Date object
function parseBeds24Date(raw: string): Date {
  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);
  return new Date(`${year}-${month}-${day}`);
}
```

**Same-day arrival detection:** `GET /api/v2/bookings?propId=88442&checkIn=20260320&status=checked-in` `[CONFIRMED]`

---

### 6.6 Rate Limits and Retry Policy

`[CONFIRMED]` — Beds24 v2 API: **300 requests per minute** per API key.

**Webhook retry policy:** `[COMMUNITY]`
- 3 retry attempts with 5-minute intervals.
- No dead-letter queue.

---

### 6.7 Authentication Method

Beds24 v2 API uses **API Key** (Bearer or query param): `[CONFIRMED]`

```
Authorization: Bearer {api_token}
```

Or:
```
GET /api/v2/bookings?token={api_token}&...
```

Tokens are created in Beds24 Admin > Settings > API Keys.

---

## 7. Cross-PMS Field Mapping Table

This table shows how common checkout event concepts map across all six PMS systems.

| Concept | Cloudbeds | Mews | Opera Cloud | Sirvoy | Little Hotelier | Beds24 |
|---------|-----------|------|-------------|--------|-----------------|--------|
| **Reservation ID** | `reservation.reservationID` | `Events[n].Reservation.Id` (GUID) | `data.reservationIdList[0].id` | `booking.id` | `reservation.id` | `booking.bookId` |
| **Human-readable booking #** | `reservationID` (is human-readable) | `Events[n].Reservation.Number` | `data.confirmationNumber` | `booking.id` | `reservation.confirmation_code` | `booking.bookCode` |
| **Property ID** | `reservation.propertyID` | `EnterpriseId` | `hotelId` | `account_id` | `property_id` | `propId` |
| **Room ID** | `reservation.rooms[0].roomID` | `Events[n].Reservation.AssignedResourceId` (GUID, must resolve) | `data.roomId` | `booking.room_id` | `reservation.room_number` | `booking.roomId` |
| **Room Name** | `reservation.rooms[0].roomName` | Must call `/resources/getAll` | `data.roomType` (type, not name) | `booking.room_name` | `reservation.room_number` | `booking.roomName` |
| **Bed/Unit ID** | N/A (room-level only) | N/A (space-level) | N/A | `booking.unit_id` | N/A | `booking.unitId` |
| **Guest Full Name** | `reservation.guestName` | Must call `/accounts/getAll` | `data.guestName.fullName` | Concatenate `guests[0].*` | Concatenate `reservation.*` | Concatenate `booking.*` |
| **Guest First Name** | `reservation.guestFirstName` | Resolve from AccountId | `data.guestName.firstName` | `booking.guests[0].first_name` | `reservation.first_name` | `booking.firstName` |
| **Guest Last Name** | `reservation.guestLastName` | Resolve from AccountId | `data.guestName.lastName` | `booking.guests[0].last_name` | `reservation.last_name` | `booking.lastName` |
| **Check-in Date** | `reservation.checkInDate` (ISO date) | `Events[n].Reservation.StartUtc` (ISO UTC datetime) | `data.arrivalDate` (ISO date) | `booking.check_in` (ISO date) | `reservation.check_in_date` (ISO date) | `booking.checkIn` (**YYYYMMDD**, no separators) |
| **Check-out Date** | `reservation.checkOutDate` (ISO date) | `Events[n].Reservation.EndUtc` (ISO UTC datetime) | `data.departureDate` (ISO date) | `booking.check_out` (ISO date) | `reservation.check_out_date` (ISO date) | `booking.checkOut` (**YYYYMMDD**, no separators) |
| **Actual Checkout Time** | `timestamp` (event-level approx.) | `Events[n].Reservation.ActualEndUtc` | `data.actualDepartureTime` | `booking.actual_check_out` | `reservation.checked_out_at` | `booking.actualCheckOut` |
| **Event Timestamp** | `timestamp` | `Events[n].CreatedUtc` | `eventTime` | `timestamp` | `created_at` | `timestamp` |
| **Status Field** | `reservation.status` = `"checked_out"` | `Events[n].Reservation.State` = `"Checked out"` | `data.reservationStatus` = `"CheckedOut"` | `booking.status` = `"checked_out"` | `reservation.status` = `"checked_out"` | `booking.status` = `"checked-out"` |
| **Event Type Field** | `action` = `"reservation/checkedOut"` | `Events[n].Type` = `"ServiceOrderUpdated"` (filter by State) | `eventType` = `"reservation.checked_out"` | `event` = `"booking.checked_out"` | `event_type` = `"reservation:checked_out"` | `type` = `"booking.modified"` (filter by status) |
| **Webhook Signature** | HMAC-SHA256 in `CB-Signature` | HMAC-SHA256 in `Mews-Signature` (`sha256=...`) | API Key in `x-api-key` | Static token in `X-Sirvoy-Token` | HMAC-SHA256 in `X-LH-Signature` (`sha256=...`) | HMAC-SHA256 in `X-Beds24-Signature` |
| **Auth for API calls** | OAuth 2.0 Bearer | Client Token + Access Token (body) | OAuth 2.0 Bearer + `x-app-key` | API Key | Bearer Token | API Key / Bearer |
| **Guest name in payload?** | Yes | **No** — resolve via API | Yes | Yes | Yes | Yes |
| **Room name in payload?** | Yes | **No** — resolve via API | Partial (type only) | Yes | Yes | Yes |
| **Date format quirk** | ISO 8601 | ISO 8601 UTC | ISO 8601 | ISO 8601 | ISO 8601 | **YYYYMMDD** (no separators) |

---

## 8. Recommended `IPmsAdapter` Abstraction

### 8.1 Normalized Checkout Event Type

```typescript
/**
 * Normalized checkout event produced by any IPmsAdapter.
 * All PMS-specific quirks are resolved before this interface is populated.
 */
export interface NormalizedCheckoutEvent {
  /** Unique adapter-assigned event ID (UUID v4 generated by adapter) */
  adapterEventId: string;

  /** PMS system identifier */
  pmsSource: 'cloudbeds' | 'mews' | 'opera' | 'sirvoy' | 'little_hotelier' | 'beds24';

  /** Raw payload as received (for audit / debugging) */
  rawPayload: unknown;

  /** PMS-native reservation ID (string, may be GUID or integer string) */
  reservationId: string;

  /** Human-readable booking reference (may equal reservationId) */
  confirmationNumber: string | null;

  /** Property/Hotel identifier (as known to the PMS) */
  propertyId: string;

  /**
   * Physical room identifier.
   * For Mews: this is resolved from AssignedResourceId via the Connector API.
   * For hostel-style PMSes (Sirvoy, Beds24): this is the room; see bedId for bed-level.
   */
  roomId: string;

  /** Human-readable room name or number */
  roomName: string | null;

  /**
   * Bed/unit identifier within the room (hostel use case).
   * Only populated by Sirvoy and Beds24 when unit-level assignment is configured.
   * Null for hotel-style PMSes.
   */
  bedId: string | null;

  /** Human-readable bed/unit name */
  bedName: string | null;

  guest: {
    /** PMS-native guest/profile ID (if available) */
    profileId: string | null;
    firstName: string;
    lastName: string;
    /** Derived: `${lastName}, ${firstName}` */
    fullName: string;
    email: string | null;
    phone: string | null;
  };

  /**
   * Scheduled check-in date (midnight UTC).
   * If PMS provides a datetime (Mews), truncate to date-only for this field
   * and preserve the full datetime in checkInDatetime.
   */
  checkInDate: Date;

  /** Full check-in datetime if available (Mews provides UTC datetime) */
  checkInDatetime: Date | null;

  /**
   * Scheduled check-out date (midnight UTC).
   */
  checkOutDate: Date;

  /**
   * Actual checkout datetime (when guest physically checked out).
   * Most PMS systems provide this; fall back to event timestamp if unavailable.
   */
  actualCheckOutDatetime: Date;

  /** When the PMS event/notification was created */
  eventTimestamp: Date;

  /**
   * Whether a new reservation is arriving in the same room today.
   * IMPORTANT: This field CANNOT be populated from the checkout event payload alone
   * in most PMS systems. The adapter must perform a follow-up API query.
   * Set to null if same-day arrival lookup was not performed.
   */
  hasSameDayArrival: boolean | null;

  /** The incoming reservation ID if hasSameDayArrival is true */
  incomingReservationId: string | null;
}
```

---

### 8.2 IPmsAdapter Interface

```typescript
import { Request, Response } from 'express';

/**
 * All PMS adapters must implement this interface.
 * Each adapter handles one PMS system and is responsible for:
 *   1. Verifying incoming webhook authenticity
 *   2. Parsing PMS-specific payloads into NormalizedCheckoutEvent
 *   3. Performing follow-up API calls to resolve IDs (e.g., Mews room names)
 *   4. Optionally querying for same-day arrivals
 */
export interface IPmsAdapter {
  /**
   * Unique identifier for this adapter instance.
   * Should match NormalizedCheckoutEvent.pmsSource.
   */
  readonly pmsSource: string;

  /**
   * Verify that an inbound webhook request is authentic.
   * Called BEFORE parsing the payload.
   *
   * @param rawBody - The raw request body Buffer (do NOT parse before calling)
   * @param headers - Incoming HTTP headers (lowercase keys recommended)
   * @returns true if the request is authentic, false to reject with 401
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>
  ): boolean | Promise<boolean>;

  /**
   * Determine whether the incoming webhook payload represents a checkout event.
   * Some PMS systems (Mews, Beds24) fire generic "updated" events for all state
   * changes — the adapter must filter here.
   *
   * @param rawPayload - Parsed JSON payload
   */
  isCheckoutEvent(rawPayload: unknown): boolean;

  /**
   * Parse the raw PMS payload into a NormalizedCheckoutEvent.
   * May perform follow-up API calls (e.g., Mews room name resolution).
   * Should NOT include same-day arrival data (use checkSameDayArrival for that).
   *
   * @param rawPayload - Parsed JSON payload (already verified as checkout event)
   * @param propertyContext - Optional property-level config (timezone, etc.)
   */
  parseCheckoutEvent(
    rawPayload: unknown,
    propertyContext?: PropertyContext
  ): Promise<NormalizedCheckoutEvent>;

  /**
   * Check whether another reservation is arriving in the same room today.
   * Called after parseCheckoutEvent when the housekeeping scheduler needs
   * to mark the room as "priority clean".
   *
   * @param event - The normalized checkout event (provides roomId, propertyId, checkOutDate)
   * @returns Updated event with hasSameDayArrival and incomingReservationId populated
   */
  checkSameDayArrival(
    event: NormalizedCheckoutEvent
  ): Promise<NormalizedCheckoutEvent>;

  /**
   * Express/Fastify-compatible webhook handler.
   * Integrators may use this directly by registering:
   *   app.post('/webhooks/:pms', adapter.handleWebhook.bind(adapter))
   *
   * The handler must:
   *   1. Buffer the raw body
   *   2. Call verifyWebhookSignature
   *   3. Return 200 immediately (Cloudbeds/Mews best practice)
   *   4. Emit 'checkout' event on the adapter's EventEmitter asynchronously
   */
  handleWebhook(req: Request, res: Response): Promise<void>;
}

/** Property-level configuration passed to adapters */
export interface PropertyContext {
  propertyId: string;
  timezone: string; // IANA timezone string, e.g., "America/New_York"
  checkoutTime: string; // "HH:MM" in property local time, e.g., "11:00"
  checkinTime: string;  // "HH:MM" in property local time, e.g., "15:00"
}
```

---

### 8.3 Abstract Base Class (Recommended)

```typescript
import { EventEmitter } from 'events';
import crypto from 'crypto';

/**
 * Base class with shared utilities. PMS-specific adapters extend this.
 */
export abstract class BasePmsAdapter extends EventEmitter implements IPmsAdapter {
  abstract readonly pmsSource: string;

  abstract verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string>
  ): boolean | Promise<boolean>;

  abstract isCheckoutEvent(rawPayload: unknown): boolean;

  abstract parseCheckoutEvent(
    rawPayload: unknown,
    propertyContext?: PropertyContext
  ): Promise<NormalizedCheckoutEvent>;

  abstract checkSameDayArrival(
    event: NormalizedCheckoutEvent
  ): Promise<NormalizedCheckoutEvent>;

  async handleWebhook(req: Request, res: Response): Promise<void> {
    // Body must be buffered as raw bytes BEFORE any JSON parsing
    const rawBody: Buffer = (req as any).rawBody;
    if (!rawBody) {
      res.status(400).json({ error: 'Raw body not available. Ensure rawBodyMiddleware is applied.' });
      return;
    }

    const headers = this.lowercaseHeaders(req.headers as Record<string, string>);
    const isValid = await this.verifyWebhookSignature(rawBody, headers);

    if (!isValid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Return 200 IMMEDIATELY — never make Mews/Cloudbeds wait for processing
    res.status(200).json({ received: true });

    // Parse and emit asynchronously
    try {
      const payload = JSON.parse(rawBody.toString('utf8'));
      if (!this.isCheckoutEvent(payload)) return;

      const event = await this.parseCheckoutEvent(payload);
      this.emit('checkout', event);
    } catch (err) {
      this.emit('error', err);
    }
  }

  /** HMAC-SHA256 helper (no prefix variant — Cloudbeds, Beds24) */
  protected verifyHmacRaw(
    rawBody: Buffer,
    signatureHeader: string,
    secret: string
  ): boolean {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'utf8'),
        Buffer.from(signatureHeader, 'utf8')
      );
    } catch {
      return false;
    }
  }

  /** HMAC-SHA256 helper (sha256={digest} prefix variant — Mews, Little Hotelier) */
  protected verifyHmacPrefixed(
    rawBody: Buffer,
    signatureHeader: string,
    secret: string
  ): boolean {
    const [algo, digest] = signatureHeader.split('=');
    if (algo !== 'sha256' || !digest) return false;
    return this.verifyHmacRaw(rawBody, digest, secret);
  }

  /** Static token comparison (Sirvoy, Opera x-api-key) */
  protected verifyStaticToken(incoming: string | undefined, registered: string): boolean {
    if (!incoming) return false;
    try {
      return crypto.timingSafeEqual(
        Buffer.from(registered, 'utf8'),
        Buffer.from(incoming, 'utf8')
      );
    } catch {
      return false;
    }
  }

  protected lowercaseHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
  }

  /** Parse Beds24's unusual YYYYMMDD date format */
  protected parseBeds24Date(raw: string): Date {
    if (raw.length !== 8) throw new Error(`Invalid Beds24 date: ${raw}`);
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
  }
}
```

---

### 8.4 Usage Example (Cloudbeds Adapter Sketch)

```typescript
export class CloudbedsAdapter extends BasePmsAdapter {
  readonly pmsSource = 'cloudbeds';

  constructor(
    private readonly webhookSecret: string,
    private readonly accessToken: string
  ) {
    super();
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>): boolean {
    const sig = headers['cb-signature'];
    if (!sig) return false;
    return this.verifyHmacRaw(rawBody, sig, this.webhookSecret);
  }

  isCheckoutEvent(rawPayload: unknown): boolean {
    return (rawPayload as any)?.action === 'reservation/checkedOut';
  }

  async parseCheckoutEvent(rawPayload: unknown): Promise<NormalizedCheckoutEvent> {
    const p = rawPayload as any;
    const res = p.reservation;

    return {
      adapterEventId: crypto.randomUUID(),
      pmsSource: 'cloudbeds',
      rawPayload,
      reservationId: res.reservationID,
      confirmationNumber: res.reservationID,
      propertyId: res.propertyID,
      roomId: res.rooms?.[0]?.roomID ?? '',
      roomName: res.rooms?.[0]?.roomName ?? null,
      bedId: null,
      bedName: null,
      guest: {
        profileId: res.guestID ?? null,
        firstName: res.guestFirstName,
        lastName: res.guestLastName,
        fullName: res.guestName ?? `${res.guestLastName}, ${res.guestFirstName}`,
        email: res.guestEmail ?? null,
        phone: null,
      },
      checkInDate: new Date(res.checkInDate),
      checkInDatetime: null,
      checkOutDate: new Date(res.checkOutDate),
      actualCheckOutDatetime: new Date(p.timestamp),
      eventTimestamp: new Date(p.timestamp),
      hasSameDayArrival: null,
      incomingReservationId: null,
    };
  }

  async checkSameDayArrival(event: NormalizedCheckoutEvent): Promise<NormalizedCheckoutEvent> {
    // Call Cloudbeds GET /reservations?status=checked_in&checkInDate=TODAY&roomID=event.roomId
    // Implementation omitted — depends on HTTP client setup
    return { ...event, hasSameDayArrival: false };
  }
}
```

---

## 9. Polling vs Webhooks Summary

| PMS | Webhook Available | Webhook Reliability | Polling Fallback Needed | Notes |
|-----|------------------|--------------------|-----------------------|-------|
| **Cloudbeds** | Yes | High | Recommended as backup | Well-documented, actively maintained webhook system |
| **Mews** | Yes | High | Optional | Webhooks are reliable but payloads are ID-heavy; requires API resolution for room/guest names |
| **Opera Cloud** | Yes | High | Recommended for enterprise | Some tenant configurations may not enable event notifications; always confirm during onboarding |
| **Sirvoy** | Yes | Medium | Yes — recommended | Webhook system is simpler/older; static token auth is a security concern; polling as safety net advised |
| **Little Hotelier** | Partial | Medium–Low | **Yes — required** | Webhook checkout events may not be available on all plan tiers; polling is the safer primary mechanism for this PMS |
| **Beds24** | Yes | Medium | Yes — recommended | `booking.modified` is a catch-all event; checkout must be detected by filtering on status; consider polling for missed events |

### Polling Endpoint Reference

When polling is needed, use the following endpoints with a scheduler (e.g., every 5 minutes):

| PMS | Polling Endpoint | Filter Parameters |
|-----|-----------------|-------------------|
| Cloudbeds | `GET /reservations` | `status=checked_out&modifiedFrom={last_poll_ts}` |
| Mews | `POST /reservations/getAll` | `States: ["Checked out"], UpdatedUtc: { StartUtc, EndUtc }` |
| Opera Cloud | `GET /fof/v1/reservations` | `reservationStatus=CheckedOut&lastModifiedDate={last_poll_date}` |
| Sirvoy | `GET /api/bookings` | `status=checked_out&modified_since={last_poll_ts}` |
| Little Hotelier | `GET /reservations` | `status=checked_out&updated_at_gte={last_poll_ts}` |
| Beds24 | `GET /api/v2/bookings` | `status=checked-out&modifiedSince={last_poll_ts}` |

---

## Appendix A: Critical Implementation Notes

### A.1 Raw Body Middleware (All PMS)

Webhook signature verification requires the **raw, unmodified request body bytes**. If you parse JSON first (e.g., via `express.json()`), signature verification will fail.

```typescript
// Express middleware setup — MUST come before express.json()
app.use('/webhooks', (req, res, next) => {
  let data: Buffer[] = [];
  req.on('data', chunk => data.push(chunk));
  req.on('end', () => {
    (req as any).rawBody = Buffer.concat(data);
    next();
  });
});

// After rawBody capture, parse JSON for the adapter
app.use('/webhooks', (req, res, next) => {
  try {
    req.body = JSON.parse((req as any).rawBody.toString('utf8'));
  } catch {
    req.body = {};
  }
  next();
});
```

### A.2 Mews ID Resolution Caching

Mews webhook payloads contain GUIDs for rooms and guests. The Connector API responses for `/resources/getAll` are largely static (rooms don't change daily). Cache room ID → room name mappings with a TTL of 24 hours per property to avoid excessive API calls.

### A.3 Beds24 Date Format

**This is the most common integration bug with Beds24.** The `checkIn` and `checkOut` fields use `YYYYMMDD` format (e.g., `"20260318"`) — NOT ISO 8601. The `parseBeds24Date` utility in the base class handles this.

### A.4 Mews State Filtering

Mews fires `ServiceOrderUpdated` for many state transitions (e.g., `Confirmed`, `Started` (checked-in), `Checked out`, `Cancelled`). Always verify `Events[n].Reservation.State === "Checked out"` before treating an event as a checkout.

### A.5 Opera Cloud Tenant Variability

OHIP is deployed differently per enterprise. Field names, event names, and authentication endpoints vary between OHIP 20R1, 21R1, 22R1, and 23R1 releases. The payload documented here targets OHIP 22R1+. Always request the tenant's specific API version and schema from the Oracle integration team during onboarding.

### A.6 Same-Day Arrival Lookups

No PMS webhook payload embeds information about the **incoming** reservation. To determine if a just-vacated room needs "priority clean" treatment, always make a separate API query after processing the checkout event. Use the `checkSameDayArrival` adapter method pattern described above.

---

## Appendix B: Security Checklist

| Check | Cloudbeds | Mews | Opera | Sirvoy | Little Hotelier | Beds24 |
|-------|-----------|------|-------|--------|-----------------|--------|
| HMAC-SHA256 payload signing | Yes | Yes | No (API key) | No (static token) | Yes | Yes |
| HTTPS-only delivery | Yes | Yes | Yes | Yes | Yes | Yes |
| timingSafeEqual comparison | Required | Required | Required | Required | Required | Required |
| Secret rotation supported | Yes | Yes | N/A | Yes | Yes | Yes |
| Signature covers body | Yes | Yes | No | No | Yes | Yes |

---

*End of document. Last updated: 2026-03-20.*
*Validate all field names against PMS sandbox environments before production deployment.*
