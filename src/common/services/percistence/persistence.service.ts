import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import mongoose, { Connection, Model } from 'mongoose';
import { Role } from '@prisma/client';
import { SchemaModel, SchemaModelSchema } from 'src/mongoose/schemas.schema';
import { InjectModel } from '@nestjs/mongoose';
import { WithExtra } from 'src/common/types/global';

@Injectable()
export class PersistenceService {
  private roles: Role[] | null = null;
  private countries: any[] | null = null;
  private schemas: WithExtra<SchemaModel, { _id: string }>[] | null = null;

  private connections: Map<string, Connection> = new Map();

  constructor(
    private prismaService: PrismaService,
    @InjectModel('Schema') private readonly schemaModel: Model<WithExtra<SchemaModel, { _id: string }>>,
  ) {
    this.loadRoles().catch(console.error);
    this.loadSchemas().catch(console.error);
  }

  // === ROLES ===
  private async loadRoles(): Promise<void> {
    console.log('PersistenceService: Loading roles from DB...');
    try {
      this.roles = await this.prismaService.role.findMany();
      console.log(`PersistenceService: Loaded ${this.roles?.length} roles.`);
    } catch (error) {
      console.error('PersistenceService: Error loading roles:', error);
      this.roles = [];
    }
  }

  getRoles(): Role[] {
    if (!this.roles) {
      this.loadRoles().catch(console.error);
      return [];
    }
    return this.roles;
  }

  async refreshRoles(): Promise<void> {
    console.log('PersistenceService: Refreshing roles cache...');
    await this.loadRoles();
  }

  // === SCHEMAS ===
  private async loadSchemas(): Promise<void> {
    console.log('PersistenceService: Loading schemas from Mongo...');
    try {
      const allSchemas = await this.schemaModel.find({ deleted: false }).lean();
      this.schemas = allSchemas;
      console.log(`PersistenceService: Loaded ${this.schemas?.length} schemas.`);
    } catch (error) {
      console.error('PersistenceService: Error loading schemas:', error);
      this.schemas = [];
    }
  }

  getSchemas(): SchemaModel[] {
    if (!this.schemas) {
      this.loadSchemas().catch(console.error);
      return [];
    }
    return this.schemas;
  }

  getSchemaById(schema_id: string): SchemaModel | undefined {
    return this.schemas?.find((s) => s._id.toString() === schema_id);
  }

  async refreshSchemas(): Promise<void> {
    console.log('PersistenceService: Refreshing schemas cache...');
    await this.loadSchemas();
  }

  // === MULTI-DB ===

  /**
   * Obtiene la conexión Mongo para un company_id.
   * Si no existe, la crea y la guarda en caché.
   */
  async getMongoConnection(companyId: string): Promise<Connection> {
    if (this.connections.has(companyId)) {
      return this.connections.get(companyId)!;
    }

    const dbName = `tenant_${companyId}`;
    const baseUri = `${process.env.MONGODB_API}${process.env.MONGO_PERMISSIONS}`; 
  
    if (!baseUri) {
      throw new Error('MONGODB_API is not defined!');
    }
    const [clusterUri, params] = baseUri.split('?');
    const uri = `${clusterUri.replace(/\/$/, '')}/${dbName}?${params}`;
  
    console.log(`PersistenceService: Connecting to ${uri}`);
    const connection = mongoose.createConnection(uri);
    connection.on('error', err => {
      console.error('[PersistenceService] Mongo connection error:', err);
    });
    await connection.asPromise();
    this.connections.set(companyId, connection);
    console.log(`[PersistenceService] Connected to DB: ${connection.name}`);
    return connection;
  }
  
  /**
   * Devuelve un Model para una colección específica en la DB correcta.
   */
  async getTenantModel<T>(
    companyId: string,
    modelName: string,
    schema: any,
  ): Promise<Model<T>> {
    const connection = await this.getMongoConnection(companyId);
    if (connection.models[modelName]) {
      return connection.models[modelName];
    }
    return connection.model<T>(modelName, schema);
  }
}
