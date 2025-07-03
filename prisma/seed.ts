import { PrismaClient } from '@prisma/client';


import * as fs from 'fs';
import * as path from 'path';

interface DepartmentData {
  name: string;
  cities: string[];
}

interface ColombiaData {
  departments: DepartmentData[];
}


const prisma = new PrismaClient();

async function main() {
  // Crear rol USER si no existe
  await prisma.role.upsert({
    where: { name: 'USER' },
    update: {},
    create: {
      name: 'USER',
    },
  });

  // Crear rol ADMIN si no existe
  await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: {
      name: 'ADMIN',
    },
  });

  console.log('Roles USER y ADMIN creados/actualizados.');

}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
