# 📋 API Endpoints Documentation

## 🚀 Base URL
```
http://localhost:3000
```

---

## 👥 Users Endpoints

### ➕ Create User
```bash
POST /users
```

**Request:**
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Juan Pérez",
    "email": "juan.perez@example.com",
    "password": "123456",
    "phone": "+34 612 345 678"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "id": 1,
    "name": "Juan Pérez",
    "email": "juan.perez@example.com",
    "phone": "+34 612 345 678",
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "statusCode": 201
}
```

### 📋 Get All Users
```bash
GET /users
```

**Request:**
```bash
curl http://localhost:3000/users
```

### 🔍 Get User by ID
```bash
GET /users/:id
```

**Request:**
```bash
curl http://localhost:3000/users/1
```

### 📊 Get User Count
```bash
GET /users/count
```

**Request:**
```bash
curl http://localhost:3000/users/count
```

### ✏️ Update User
```bash
PATCH /users/:id
```

**Request:**
```bash
curl -X PATCH http://localhost:3000/users/1 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Juan Pérez Updated",
    "phone": "+34 999 888 777"
  }'
```

### 🗑️ Delete User
```bash
DELETE /users/:id
```

**Request:**
```bash
curl -X DELETE http://localhost:3000/users/1
```

---

## 📅 Appointments Endpoints

### ➕ Create Appointment
```bash
POST /appointments
```

**Request:**
```bash
curl -X POST http://localhost:3000/appointments \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Consulta médica",
    "description": "Revisión general de salud",
    "appointmentDate": "2024-12-25T10:00:00.000Z",
    "duration": 60,
    "location": "Consultorio 101",
    "notes": "Traer exámenes previos",
    "userId": 1
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Appointment created successfully",
  "data": {
    "id": 1,
    "title": "Consulta médica",
    "description": "Revisión general de salud",
    "appointmentDate": "2024-12-25T10:00:00.000Z",
    "duration": 60,
    "status": "scheduled",
    "location": "Consultorio 101",
    "notes": "Traer exámenes previos",
    "userId": 1,
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "statusCode": 201
}
```

### 📋 Get All Appointments
```bash
GET /appointments
```

**Query Parameters:**
- `userId` (optional): Filter by user ID
- `status` (optional): Filter by status
- `startDate` (optional): Filter from date (ISO format)
- `endDate` (optional): Filter to date (ISO format)
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)

**Examples:**
```bash
# Get all appointments
curl http://localhost:3000/appointments

# Get appointments for user 1
curl http://localhost:3000/appointments?userId=1

# Get scheduled appointments
curl http://localhost:3000/appointments?status=scheduled

# Get appointments with date range
curl "http://localhost:3000/appointments?startDate=2024-01-01&endDate=2024-12-31"

# Get with pagination
curl "http://localhost:3000/appointments?page=1&limit=5"
```

### 🔍 Get Appointment by ID
```bash
GET /appointments/:id
```

**Request:**
```bash
curl http://localhost:3000/appointments/1
```

### 👤 Get Appointments by User
```bash
GET /appointments/user/:userId
```

**Request:**
```bash
curl http://localhost:3000/appointments/user/1
```

### 📊 Get Appointments by Status
```bash
GET /appointments/status/:status
```

**Request:**
```bash
curl http://localhost:3000/appointments/status/scheduled
```

### ⏰ Get Upcoming Appointments
```bash
GET /appointments/upcoming
```

**Request:**
```bash
curl http://localhost:3000/appointments/upcoming
```

### ✏️ Update Appointment
```bash
PATCH /appointments/:id
```

**Request:**
```bash
curl -X PATCH http://localhost:3000/appointments/1 \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Consulta médica actualizada",
    "duration": 90,
    "location": "Consultorio 102"
  }'
```

### 🔄 Update Appointment Status
```bash
PATCH /appointments/:id/status
```

**Request:**
```bash
curl -X PATCH http://localhost:3000/appointments/1/status \
  -H "Content-Type: application/json" \
  -d '{
    "status": "confirmed"
  }'
```

### ✅ Confirm Appointment
```bash
PATCH /appointments/:id/confirm
```

**Request:**
```bash
curl -X PATCH http://localhost:3000/appointments/1/confirm
```

### ❌ Cancel Appointment
```bash
PATCH /appointments/:id/cancel
```

**Request:**
```bash
curl -X PATCH http://localhost:3000/appointments/1/cancel
```

### ✔️ Complete Appointment
```bash
PATCH /appointments/:id/complete
```

**Request:**
```bash
curl -X PATCH http://localhost:3000/appointments/1/complete
```

### 🗑️ Delete Appointment
```bash
DELETE /appointments/:id
```

**Request:**
```bash
curl -X DELETE http://localhost:3000/appointments/1
```

---

## 📊 Response Formats

### ✅ Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/endpoint",
  "statusCode": 200
}
```

### ❌ Error Response
```json
{
  "success": false,
  "message": "Error message",
  "error": "ERROR_CODE",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/endpoint",
  "statusCode": 400
}
```

### ⚠️ Validation Error Response
```json
{
  "success": false,
  "message": "Validation failed",
  "error": "VALIDATION_ERROR",
  "validationErrors": [
    "name must be a string",
    "email must be an email"
  ],
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/endpoint",
  "statusCode": 400
}
```

### 📄 Paginated Response
```json
{
  "success": true,
  "message": "Data retrieved successfully",
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 25,
      "totalPages": 3
    }
  },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/endpoint",
  "statusCode": 200
}
```

---

## 🏷️ Appointment Status Values

| Status | Description |
|--------|-------------|
| `scheduled` | Cita programada |
| `confirmed` | Cita confirmada |
| `in_progress` | Cita en progreso |
| `completed` | Cita completada |
| `cancelled` | Cita cancelada |
| `no_show` | No se presentó |

---

## ✅ Validation Rules

### 👤 User Creation
- **name**: required, string, not empty
- **email**: required, valid email format, unique
- **password**: required, string, minimum 6 characters
- **phone**: optional, string

### 📅 Appointment Creation
- **title**: required, string, not empty
- **description**: optional, string
- **appointmentDate**: required, valid ISO date string, cannot be in the past
- **duration**: optional, number, positive, min: 15, max: 480 (default: 60)
- **status**: optional, valid enum value (default: scheduled)
- **location**: optional, string
- **notes**: optional, string
- **userId**: required, number, positive, must exist

---

## 🧪 Testing Sequence

### 1️⃣ Create a User
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "123456"
  }'
```

### 2️⃣ Verify User Creation
```bash
curl http://localhost:3000/users
```

### 3️⃣ Create Appointment
```bash
curl -X POST http://localhost:3000/appointments \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Appointment",
    "appointmentDate": "2024-12-25T10:00:00.000Z",
    "userId": 1
  }'
```

### 4️⃣ Verify Appointment Creation
```bash
curl http://localhost:3000/appointments
curl http://localhost:3000/appointments/user/1
```

### 5️⃣ Update Appointment Status
```bash
curl -X PATCH http://localhost:3000/appointments/1/confirm
```

---

## 📝 Notes

- 📅 All dates should be in ISO 8601 format
- ⚡ Time conflict validation is implemented for appointments
- 🗑️ Soft delete is used (isActive flag)
- 📄 Pagination is available for appointments listing
- 🔗 User-appointment relationship is properly maintained
- 📊 All responses follow the standardized format
- 🔒 Password is not returned in responses for security

---

## 🚀 Quick Start Commands

```bash
# Start the server
npm run start:dev

# Create test user
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Test User", "email": "test@example.com", "password": "123456"}'

# Create test appointment
curl -X POST http://localhost:3000/appointments \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Appointment", "appointmentDate": "2024-12-25T10:00:00.000Z", "userId": 1}'

# View all data
curl http://localhost:3000/users
curl http://localhost:3000/appointments
```
```

También puedes crear un archivo adicional con comandos listos para copiar y pegar:

```bash:test-commands.sh
#!/bin/bash

# API Testing Commands
# ===================

echo "🚀 Starting API Tests..."

BASE_URL="http://localhost:3000"

echo "1️⃣ Creating test user..."
curl -X POST $BASE_URL/users \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "123456",
    "phone": "+1234567890"
  }'

echo -e "\n\n2️⃣ Getting all users..."
curl $BASE_URL/users

echo -e "\n\n3️⃣ Creating test appointment..."
curl -X POST $BASE_URL/appointments \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Appointment",
    "description": "Test description",
    "appointmentDate": "2024-12-25T10:00:00.000Z",
    "duration": 60,
    "location": "Test Location",
    "userId": 1
  }'

echo -e "\n\n4️⃣ Getting all appointments..."
curl $BASE_URL/appointments

echo -e "\n\n5️⃣ Getting user appointments..."
curl $BASE_URL/appointments/user/1

echo -e "\n\n6️⃣ Confirming appointment..."
curl -X PATCH $BASE_URL/appointments/1/confirm

echo -e "\n\n✅ Tests completed!"
```

Para usar el script:
```bash
chmod +x test-commands.sh
./test-commands.sh