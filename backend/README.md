# Movie Booking Service

Node.js + Express mikroservisi. Seat locking, to'lov oqimi va bekor qilishni boshqaradi.

## Stack

| Qatlam | Texnologiya |
|---|---|
| HTTP Framework | Express 4 |
| Database | PostgreSQL (pg pool) |
| Cache / Lock | Redis (ioredis) |
| Message Queue | RabbitMQ (amqplib) |
| Auth | JWT (API Gateway tomonidan beriladi) |
| Logging | Winston |
| Validation | express-validator |

## Loyiha tuzilmasi

```
src/
├── config/
│   ├── db.js          ← PostgreSQL pool + withTransaction helper
│   ├── redis.js       ← Redis + atomic seat lock Lua script
│   └── migrate.js     ← DB schema migration
├── controllers/
│   └── bookingController.js   ← HTTP layer
├── services/
│   └── bookingService.js      ← Biznes logika (asosiy)
├── repositories/
│   └── bookingRepository.js   ← DB so'rovlari
├── middleware/
│   └── index.js       ← auth, errorHandler, requestLogger
├── routes/
│   └── index.js       ← express-validator bilan endpointlar
├── events/
│   └── publisher.js   ← RabbitMQ event publish
├── utils/
│   ├── AppError.js    ← Custom error class
│   └── logger.js      ← Winston logger
└── index.js           ← Bootstrap + graceful shutdown
```

## Ishga tushirish

```bash
# 1. .env fayl
cp .env.example .env
# (kerakli qiymatlarni to'ldiring)

# 2. DB migration
node src/config/migrate.js

# 3. Development
npm run dev

# 4. Testlar
npm test
```

## API Endpointlar

| Method | URL | Tavsif |
|---|---|---|
| GET | `/api/shows/:showId/seats` | Show uchun seat map |
| GET | `/api/bookings` | Foydalanuvchi booking tarixi |
| GET | `/api/bookings/:id` | Booking tafsiloti |
| POST | `/api/bookings` | Yangi booking yaratish |
| POST | `/api/bookings/:id/payment` | To'lovni boshlash |
| POST | `/api/bookings/payment-callback` | Payment gateway webhook |
| DELETE | `/api/bookings/:id` | Bookingni bekor qilish |

## Muhim dizayn qarorlari

### Seat locking (Redis Lua script)
O'rinlar atomic tarzda lock qilinadi. Agar 5 ta o'rindан biri band bo'lsa, hech biri lock qilinmaydi. TTL = 10 daqiqa. To'lov amalga oshmasa, TTL tugagach o'rinlar avtomatik ozod bo'ladi.

### Optimistic locking (PostgreSQL)
`bookings` jadvalida `version` ustuni bor. Status o'zgartirishda `WHERE version = $expected` sharti qo'yiladi. Agar boshqa jarayon avval o'zgartirgan bo'lsa — xato qaytariladi va foydalanuvchi qayta urinadi.

### Idempotency
`POST /bookings` da `X-Idempotency-Key` header yuborilsa, takroriy so'rovlar bir xil natija qaytaradi (double-submit protection).

### Event-driven
Har bir muhim hodisa (booking yaratildi, tasdiqlandi, bekor qilindi) RabbitMQ ga publish qilinadi. Notification servisi bu eventlarni eshitib email/SMS yuboradi.
