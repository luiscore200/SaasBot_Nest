# Plan de continuidad — Módulo "Crear con IA" (NestJS + Groq)

> Versión 6. Actualizado al 25/06/2026 — fin de cuarta sesión.
> Flujo completo implementado y probado con CSV limpio (45 filas, 0 errores).

---

## 1. Contexto y objetivo

Módulo nuevo dentro de un SaaS multi-tenant (NestJS + MongoDB + React/TypeScript).
Permite que usuarios sin conocimiento técnico suban un CSV o JSON y el sistema:

1. Analice la estructura automáticamente (determinístico + LLM semántico).
2. Muestre un preview antes de comprometer nada.
3. Al confirmar, cree el schema y opcionalmente cargue los datos reales con progreso en vivo.

**Nombre del feature en el front:** "Crear con IA".
Convive con el flujo manual existente (`SchemasService` / `DocumentsService`) — no se tocan.

---

## 2. Decisiones de arquitectura firmes

| # | Decisión |
|---|----------|
| 1 | El draft **no se persiste en Mongo** — vive en memoria como `ImportJob` en `ImportQueueService`. Solo se escribe a Mongo cuando el usuario confirma. |
| 2 | Un solo job activo por `companyId`. Para crear otro, el usuario debe descartar el existente. |
| 3 | Al reconectar, el front llama `GET /import/:companyId/job` — si existe job en curso, ofrece continuar o descartar. |
| 4 | El archivo se mueve a ruta final **antes** de encolar el job. Ruta relativa (`companies/2/imports/xxx.csv`) para funcionar en cualquier instancia. |
| 5 | `name` y `description` los escribe el usuario. El LLM nunca los genera. |
| 6 | `category` se infiere vía tool calling forzado (Groq) con `enum: ['inventory', 'schedule']`. |
| 7 | El LLM nunca propone campos `auto` (`uuid` / `timestamp` / `batch_id`). |
| 8 | Muestra para el LLM y validación: 20 primeros registros. |
| 9 | Detección de header: determinística primero. Si `confidence < 0.75` → LLM resuelve en Fase 2. |
| 10 | Fase A: 100% automática. Máximo 2 intentos de reformulación. Umbral: 15% errores de campo. Si sigue > 15% tras 2 intentos → avanza con warnings. |
| 11 | Fase B: stream en lotes de 100. Progreso por SSE. Umbral errores: 20% acumulado. |
| 12 | Sin Redis. Queue = `ImportQueueService` (Map en memoria + setInterval 300ms). |
| 13 | SSE usa `ReplaySubject(20)` — el front puede conectarse después del POST y recibe todos los eventos previos. |
| 14 | `FieldDefinition` = `Omit<CreateSchemaFieldDto, 'auto'>` — reutiliza DTO canónico. |
| 15 | `createDocuments` acepta `strict: boolean = true` — Fase B pasa `false` para saltarse la revalidación de tipos ya coercionados. |

---

## 3. Flujo completo

### Fase 0 — Recepción ✅
- `POST /import/:companyId` recibe archivo + `{ name, description }`.
- Multer: temp → final antes de encolar.
- `ImportJob` en memoria con `status: 'pending'`.
- Retorna `{ jobId }`. 409 si hay job activo.

### Fase 1 — Análisis determinístico ✅
- Parseo CSV/JSON → `string[][]` posicional.
- Detección de header (5 señales, confidence 0–1, umbral 0.75).
- Perfilado por columna: ratios de tipo, `hasLeadingZeros`, etc.
- Inferencia de tipos: leadingZeros→string, numericRatio>0.95→number, dateRatio>0.9→date, booleanRatio>0.9→boolean.
- Normalización numérica: `1,234.56`, `1.234,56`, `1,5`.
- Booleanos: `true/false`, `si/no`, `y/n`, `activo/inactivo`, `on/off`, `1/0`.

### Fase 2 — LLM semántico ✅
- `INFER_SCHEMA_TOOL` forzado (`temperature: 0.1`).
- Produce: `category` + nombres semánticos por índice de columna.
- Tipos vienen de Fase 1 — el LLM no los toca.

### Fase 3 — Validación + reformulación ✅
- `coerceSample()` sobre 20 filas.
- `errorRatio = totalFieldErrors / (totalRows * nCampos)`.
- Si `errorRatio > 0.15`: `REFORMULATE_SCHEMA_TOOL` → solo corrige tipos. Máx 2 intentos.
- `records` = filas con errores → `records.length / totalRows * 100` para el preview.

### Fase 4 — Preview + SSE ✅
- Job → `status: 'preview_ready'`.
- SSE emite `step` (parsing/inference/validation) con started/done.
- Al terminar: `preview_ready` con `jobId`.
- `GET /import/:companyId/job` retorna `ImportJobData` tipado.

### Fase 5a — Confirmación schema_only ✅
- `POST /import/:companyId/confirm { action: 'schema_only' }`.
- `SchemasService.createSchema(companyId, dto)` → schema en Mongo.
- Borra archivo, descarta job, cierra SSE.
- Retorna `{ schemaId }`.

### Fase 5b — Confirmación schema_and_data ✅
- `POST /import/:companyId/confirm { action: 'schema_and_data' }`.
- Crea schema → guarda `schemaId` en job.
- Arranca `InsertionWorkerService.run()` async (fire-and-forget).
- Retorna `{ schemaId, jobId }`.

### Fase 6 — Inserción masiva (worker) ✅
- Stream CSV con `csv-parse` en modo async iterator (`for await`).
- Lotes de 100 → `coerceRow()` → `createDocuments(strict: false)`.
- SSE emite `progress: { insertados, errores, total }` por lote.
- Si `errores/total > 20%`: pausa, llama `SchemaInferenceService.reformulate()`, emite `reformulation_needed`.
- Al terminar: emite `done`, borra archivo, cierra SSE.

### Fase 7 — Decisión de reformulación ✅
- `POST /import/:companyId/jobs/decision { action: 'accept' | 'reject' }`.
- **accept**: `deleteMany({ schema_id, company_id })` → reinicia stream con schema nuevo.
- **reject**: continúa insertando con schema actual.

### Fase 8 — Finalización ✅
- Job → `status: 'completed'` o `'completed_with_errors'`.
- SSE `done`, archivo borrado, SSE cerrado.

---

## 4. Estructura de archivos del módulo

```
src/import/
  import.module.ts              ✅ DataModule + GroqModule + MulterModule + CommonModule
  import.controller.ts          ✅ todos los endpoints
  import.service.ts             ✅ Fases 0 + A + 5a + 5b + 7
  import-queue.service.ts       ✅ Map<companyId, ImportJob> + tick (300ms)
  import-sse.service.ts         ✅ ReplaySubject(20) por companyId
  import.types.ts               ✅ ImportJob, ImportJobStatus, FieldDefinition, InsertionProgress
  import.responses.ts           ✅ re-exporta tipos canónicos + interfaces HTTP
  file-parser.service.ts        ✅ Fase 1 — exporta normalizeNumeric
  schema-inference.service.ts   ✅ infer() (Fase 2) + reformulate() (Fase 3 y 6)
  schema-validator.service.ts   ✅ Fase 3 — ciclo validación + reformulación
  type-coercion.util.ts         ✅ coerceValue, coerceRow, coerceSample
  insertion-worker.service.ts   ✅ Fase 6 — stream + lotes + reformulación
```

---

## 5. Endpoints

| Método | Ruta | Retorno | Estado |
|--------|------|---------|--------|
| `POST` | `/import/:companyId` | `StartImportResponse` | ✅ |
| `GET` | `/import/:companyId/progress` | `SSE: ImportSseEvent` | ✅ |
| `GET` | `/import/:companyId/job` | `GetActiveJobResponse \| GetActiveJobWithDataResponse` | ✅ |
| `DELETE` | `/import/:companyId/job` | `DiscardJobResponse` | ✅ |
| `POST` | `/import/:companyId/confirm` | `ConfirmSchemaOnlyResponse \| ConfirmSchemaAndDataResponse` | ✅ |
| `GET` | `/import/:companyId/jobs/progress` | `SSE: ImportSseEvent` | ✅ |
| `POST` | `/import/:companyId/jobs/decision` | `{ accepted: boolean }` | ✅ |

---

## 6. Contratos SSE

```typescript
// Fase A
{ event: 'step',          data: { step: 'parsing'|'inference'|'validation', status: 'started'|'done', detail?: string } }
{ event: 'preview_ready', data: { jobId: string } }

// Fase B
{ event: 'progress',             data: { insertados: number, errores: number, total: number } }
{ event: 'reformulation_needed', data: { sugerencia: string } }
{ event: 'done',                 data: { insertados: number, errores: number, schemaId: string } }

// Compartido
{ event: 'error', data: { message: string } }
```

---

## 7. Pruebas realizadas

| Fixture | Resultado |
|---------|-----------|
| `01_clean_inventory.csv` | ✅ Fase A + B: 45/45 insertados, 0 errores, Qdrant indexado |
| `05_high_error_recoverable.csv` | ⏳ Pendiente — debe disparar reformulación en Fase B |
| `20_borderline_combined_stress.csv` | ⏳ Pendiente — debe superar 2 intentos y avanzar con warnings |
| `10_leading_zero_ids.csv` | ✅ Fase A: sku→string |
| `no_header_test.csv` | ✅ Fase A: header=false, LLM infiere nombres |

---

## 8. Pendiente de prueba / próxima sesión

### Pruebas inmediatas
1. `05_high_error_recoverable.csv` — verificar que Fase B dispara `reformulation_needed` al superar 20% de errores acumulados y que el path `accept`/`reject` funciona correctamente.
2. `20_borderline_combined_stress.csv` — verificar comportamiento con archivo irrecuperable (múltiples columnas con errores).

### Posibles mejoras detectadas
- **`ImportErrorRecord` en Mongo** — errores de Fase B actualmente se cuentan pero no se persisten. Si se quiere revisión posterior, añadir schema Mongoose y endpoint `GET /import/:companyId/jobs/errors`.
- **Progreso en `GET /job`** — el campo `progreso` se actualiza en el job en memoria; el front puede pollear como fallback si pierde la conexión SSE en Fase B.
- **Límite de tamaño de archivo** — Multer tiene un límite configurado; revisar que sea adecuado para archivos de producción.

---

## 9. Notas técnicas

- `normalizeNumeric` exportada desde `file-parser.service.ts` — reutilizar en Fase B, no reimplementar.
- `coerceValue/coerceRow/coerceSample` en `type-coercion.util.ts` — reutilizables.
- `createDocuments(companyId, schemaId, data, strict = true)` — pasar `false` desde Fase B.
- `createSchema(companyId, dto)` — dos argumentos separados.
- `PersistenceService` viene de `CommonModule` — importarlo en `ImportModule`.
- `ImportSseEvent` e `ImportJobStatus` tienen una sola fuente de verdad (`import-sse.service.ts` e `import.types.ts`) — `import.responses.ts` solo re-exporta, nunca redefine.
- El `ReplaySubject` se cierra con `subject.complete()` — llamar siempre al terminar o descartar.