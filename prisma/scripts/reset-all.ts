/**
 * scripts/reset-all.ts
 *
 * Reset completo del entorno de desarrollo:
 *   1. Prisma migrate reset (SQLite/Postgres) — sin auto-seed, lo disparamos
 *      manualmente al final para controlar el orden.
 *   2. Drop de la base de Mongo completa (todas las colecciones por tenant).
 *   3. Delete de las colecciones de Qdrant conocidas (documents, mapflow_pattern).
 *   4. Re-seed de roles + admin.
 *
 * Uso: ts-node scripts/reset-all.ts
 * (o agregar a package.json: "db:reset:all": "ts-node scripts/reset-all.ts")
 *
 * IMPORTANTE: solo para entornos de desarrollo. No correr en producción.
 */
import * as dotenv from 'dotenv';
dotenv.config(); // debe ir antes de leer cualquier process.env.* — este script
                  // corre standalone (fuera de Nest/ConfigModule), que es quien
                  // normalmente carga el .env automáticamente.

import { execSync } from 'child_process';
import * as mongoose from 'mongoose';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || '';
const MONGODB_URI =
  `${process.env.MONGODB_API ?? ''}${process.env.MONGO_PERMISSIONS ?? ''}` ||
  'mongodb://localhost:27017/mydb';

// Colecciones de Qdrant conocidas en el proyecto — agregar acá si se crean nuevas.
const QDRANT_COLLECTIONS = ['documents', 'mapflow_pattern'];

async function resetPostgres(): Promise<void> {
  console.log('\n[1/4] Reseteando base SQL (prisma migrate reset)...');
  execSync('npx prisma migrate reset --force --skip-seed', { stdio: 'inherit' });
}

async function resetMongo(): Promise<void> {
  console.log('\n[2/4] Reseteando MongoDB...');
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No se pudo obtener referencia a la base de Mongo.');

  await db.dropDatabase();
  console.log(`MongoDB en "${MONGODB_URI}" eliminada.`);
  await mongoose.disconnect();
}

async function resetQdrant(): Promise<void> {
  console.log('\n[3/4] Reseteando colecciones de Qdrant...');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(QDRANT_API_KEY && { 'api-key': QDRANT_API_KEY }),
  };

  for (const name of QDRANT_COLLECTIONS) {
    const res = await fetch(`${QDRANT_URL}/collections/${name}`, {
      method: 'DELETE',
      headers,
    });

    if (res.ok || res.status === 404) {
      console.log(`Colección "${name}" eliminada (o no existía).`);
    } else {
      const body = await res.text();
      console.warn(`No se pudo eliminar colección "${name}": ${res.status} ${body}`);
    }
  }

  // Las colecciones se vuelven a crear solas al levantar la app
  // (cada servicio llama a ensureCollection en onModuleInit).
}

async function reseed(): Promise<void> {
  console.log('\n[4/4] Reseedeando roles + admin...');
  execSync('npx prisma db seed', { stdio: 'inherit' });
}

async function main() {
  await resetPostgres();
//  await resetMongo();
  await resetQdrant();
  await reseed();
  console.log('\n✅ Reset completo: SQL + MongoDB + Qdrant + seed.');
}

main().catch((err) => {
  console.error('\n❌ Error durante el reset:', err);
  process.exit(1);
});