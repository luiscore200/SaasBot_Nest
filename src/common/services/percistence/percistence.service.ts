import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Role } from '@prisma/client'; // Importar el tipo Role de Prisma


interface City {
  id: number;
  name: string;
  departmentId: number;
  // No need to include department here if fetching from department
  // ... other city fields
}

interface Department {
  id: number;
  name: string;
  countryId: number;
  cities: City[]; // Include nested cities
  // ... other department fields
}

interface Country {
  id: number;
  name: string;
  departments: Department[]; // Include nested departments
  // ... other country fields
}

@Injectable()
export class PercistenceService {
  private roles: Role[] | null = null; // Caché para roles
  private countries: Country[] | null = null;


  constructor(private prismaService: PrismaService) { // Inyectar PrismaService
     // Cargar roles al iniciar el servicio
     this.loadRoles().catch(console.error);
  }

  // Método para cargar roles desde la DB
  private async loadRoles(): Promise<void> {
    console.log('PersistenceService: Loading roles from DB...');
    try {
      this.roles = await this.prismaService.role.findMany(); // Usar this.prismaService.prisma
      console.log(`PersistenceService: Loaded ${this.roles?.length} roles.`);
    } catch (error) {
      console.error('PersistenceService: Error loading roles:', error);
      this.roles = []; // Set to empty array on error
    }
  }

  // Método para obtener roles desde la caché
  getRoles(): Role[] {
    // Si los roles aún no se han cargado (ej. error inicial), intentar cargarlos de nuevo
    if (!this.roles) {
        this.loadRoles().catch(console.error);
        // Devolver un array vacío temporalmente o manejar de otra forma
        return [];
    }
    return this.roles;
  }

  // Método para refrescar la caché de roles
  async refreshRoles(): Promise<void> {
    console.log('PersistenceService: Refreshing roles cache...');
    await this.loadRoles(); // Simplemente recargar los roles
  }

}
