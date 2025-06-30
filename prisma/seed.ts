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

      // Primero limpiamos las tablas en el orden correcto (debido a las relaciones)
      await prisma.city.deleteMany();
      await prisma.department.deleteMany();
      await prisma.country.deleteMany();
      
      // Insertamos el país (Colombia)
      const country = await prisma.country.create({
        data: {
          name: 'Colombia',
          code: '+57'
        }
      });
  
      // Leemos el archivo JSON con los datos
      const dataPath = path.join(__dirname, 'data', 'colombia.json');
      const data: ColombiaData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  
      // Insertamos los departamentos y sus ciudades
      for (const deptData of data.departments) {
        const department = await prisma.department.create({
          data: {
            name: deptData.name,
            countryId: country.id
          }
        });
  
        // Insertamos las ciudades del departamento
        await prisma.city.createMany({
          data: deptData.cities.map(cityName => ({
            name: cityName,
            departmentId: department.id
          }))
        });
      }

      
  console.log('Ubicaciones Actualizadas.');
         
  
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
