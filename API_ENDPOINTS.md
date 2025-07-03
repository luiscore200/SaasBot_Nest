# 📋 API Endpoints Documentation

## 🚀 Base URL
```
http://localhost:3000
```

---

## 🔑 Authentication Endpoints

### ➕ Register User
```bash
POST /auth/register
```

**Request:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "securepassword",
    "name": "New User"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "id": 2,
    "email": "newuser@example.com",
    "name": "New User",
    "role": {
      "name": "USER"
    }
  },
  "statusCode": 201
}
```

### 🚪 Login User
```bash
POST /auth/login
```

**Request:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "existinguser@example.com",
    "password": "securepassword"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "User logged in successfully",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "email": "existinguser@example.com",
      "name": "Existing User",
      "role": {
        "name": "ADMIN"
      }
    }
  },
  "statusCode": 200
}
```

---

## 🏠 Application Endpoints

### 👋 Get Hello
```bash
GET /
```

**Request:**
```bash
curl http://localhost:3000/
```

**Response:**
```text
Hello World!
```

---

## 📄 Schemas Endpoints

### ➕ Create Schema
```bash
POST /schemas
```

**Request:**
```bash
curl -X POST http://localhost:3000/schemas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "CustomerSchema",
    "company_id": "company123",
    "fields": [
      { "name": "name", "type": "string", "required": true },
      { "name": "email", "type": "string", "required": true, "unique": true },
      { "name": "age", "type": "number", "required": false }
    ]
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Schema created successfully",
  "data": {
    "id": "schema123",
    "name": "CustomerSchema",
    "company_id": "company123",
    "fields": [
      { "name": "name", "type": "string", "required": true },
      { "name": "email", "type": "string", "required": true, "unique": true },
      { "name": "age", "type": "number", "required": false }
    ],
    "createdAt": "2024-07-17T10:00:00.000Z",
    "updatedAt": "2024-07-17T10:00:00.000Z"
  },
  "statusCode": 201
}
```

### 📋 Get All Schemas by Company
```bash
GET /schemas?company_id=YOUR_COMPANY_ID
```

**Request:**
```bash
curl "http://localhost:3000/schemas?company_id=company123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Schemas retrieved successfully",
  "data": [
    {
      "id": "schema123",
      "name": "CustomerSchema",
      "company_id": "company123",
      "fields": [...],
      "createdAt": "2024-07-17T10:00:00.000Z",
      "updatedAt": "2024-07-17T10:00:00.000Z"
    }
  ],
  "statusCode": 200
}
```

### 🔍 Get Schema by ID
```bash
GET /schemas/:id
```

**Request:**
```bash
curl http://localhost:3000/schemas/schema123 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Schema retrieved successfully",
  "data": {
    "id": "schema123",
    "name": "CustomerSchema",
    "company_id": "company123",
    "fields": [...],
    "createdAt": "2024-07-17T10:00:00.000Z",
    "updatedAt": "2024-07-17T10:00:00.000Z"
  },
  "statusCode": 200
}
```

### ✏️ Update Schema
```bash
PATCH /schemas/:id
```

**Request:**
```bash
curl -X PATCH http://localhost:3000/schemas/schema123 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "fields": [
      { "name": "name", "type": "string", "required": true },
      { "name": "email", "type": "string", "required": true, "unique": true },
      { "name": "age", "type": "number", "required": false },
      { "name": "address", "type": "string", "required": false }
    ]
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Schema updated successfully",
  "data": {
    "id": "schema123",
    "name": "CustomerSchema",
    "company_id": "company123",
    "fields": [
      { "name": "name", "type": "string", "required": true },
      { "name": "email", "type": "string", "required": true, "unique": true },
      { "name": "age", "type": "number", "required": false },
      { "name": "address", "type": "string", "required": false }
    ],
    "createdAt": "2024-07-17T10:00:00.000Z",
    "updatedAt": "2024-07-17T10:05:00.000Z"
  },
  "statusCode": 200
}
```

### 🗑️ Delete Schema
```bash
DELETE /schemas/:id
```

**Request:**
```bash
curl -X DELETE http://localhost:3000/schemas/schema123 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Schema deleted successfully",
  "data": null,
  "statusCode": 200
}
```

---

## 👥 User Management Endpoints

These endpoints require authentication and specific roles.

### ➕ Create User (Admin Only)
```bash
POST /user
```

**Request:**
```bash
curl -X POST http://localhost:3000/user \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -d '{
    "email": "anotheruser@example.com",
    "password": "anotherpassword",
    "name": "Another User",
    "roleId": 2 // Assuming 2 is the ID for the USER role
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Usuario creado exitosamente",
  "data": {
    "id": 3,
    "email": "anotheruser@example.com",
    "name": "Another User",
    "roleId": 2,
    "isActive": true,
    "createdAt": "2024-07-17T10:10:00.000Z",
    "updatedAt": "2024-07-17T10:10:00.000Z"
  },
  "statusCode": 201
}
```

### 📋 Get All Users (User or Admin)
```bash
GET /user
```

**Request:**
```bash
curl http://localhost:3000/user \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Usuarios obtenidos exitosamente",
  "data": [
    {
      "id": 1,
      "email": "admin@example.com",
      "name": "Admin User",
      "role": { "name": "ADMIN" }
    },
    {
      "id": 2,
      "email": "user@example.com",
      "name": "Regular User",
      "role": { "name": "USER" }
    }
  ],
  "statusCode": 200
}
```

### 🔍 Get User by ID (User or Admin)
```bash
GET /user/:id
```

**Request:**
```bash
# As Admin
curl http://localhost:3000/user/2 \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN"

# As User (viewing own profile)
curl http://localhost:3000/user/2 \
  -H "Authorization: Bearer YOUR_USER_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Usuario obtenido exitosamente",
  "data": {
    "id": 2,
    "email": "user@example.com",
    "name": "Regular User",
    "role": { "name": "USER" },
    "isActive": true,
    "createdAt": "2024-07-17T10:00:00.000Z",
    "updatedAt": "2024-07-17T10:00:00.000Z"
  },
  "statusCode": 200
}
```

### ✏️ Update User (User or Admin)
```bash
PATCH /user/:id
```

**Request:**
```bash
# As Admin
curl -X PATCH http://localhost:3000/user/2 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -d '{
    "name": "Updated Regular User"
  }'

# As User (updating own profile)
curl -X PATCH http://localhost:3000/user/2 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_USER_JWT_TOKEN" \
  -d '{
    "name": "My New Name"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Usuario actualizado exitosamente",
  "data": {
    "id": 2,
    "email": "user@example.com",
    "name": "Updated Regular User",
    "role": { "name": "USER" },
    "isActive": true,
    "createdAt": "2024-07-17T10:00:00.000Z",
    "updatedAt": "2024-07-17T10:15:00.000Z"
  },
  "statusCode": 200
}
```

### 🗑️ Delete User (User or Admin)
```bash
DELETE /user/:id
```

**Request:**
```bash
# As Admin
curl -X DELETE http://localhost:3000/user/2 \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN"

# As User (deleting own profile - check service logic if this is allowed)
# Note: The controller allows this based on the @Roles decorator, but the service might prevent it.
# Assuming service allows user to delete own profile if not ADMIN.
curl -X DELETE http://localhost:3000/user/2 \
  -H "Authorization: Bearer YOUR_USER_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Usuario eliminado exitosamente",
  "data": null,
  "statusCode": 200
}
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

## 📝 Notes

- 🔒 Authentication is required for most endpoints using a JWT token in the `Authorization: Bearer YOUR_JWT_TOKEN` header.
- 🔑 Some endpoints require specific user roles (ADMIN, USER).
- 📅 Dates are typically in ISO 8601 format.
- 🗑️ Soft delete is used (isActive flag) for users.
- 📊 All responses follow the standardized format.

---

## 🚀 Quick Start Commands

```bash
# Start the server
npm run start:dev

# Register a new user
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "testuser@example.com", "password": "password123", "name": "Test User"}'

# Login the user (get JWT token)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "testuser@example.com", "password": "password123"}'

# Example authenticated request (replace YOUR_JWT_TOKEN)
curl http://localhost:3000/user \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
