import { Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { MapflowModel, MapflowModelSchema } from '../../mongoose/mapflows.schema';
import { FlowRuntime, FlowRuntimeSchema } from 'src/mongoose/runtimes.schema';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import { CreateMapflowDto } from './dto/create-mapflow.dto';
import { UpdateMapflowDto } from './dto/update-mapflow.dto';
import { buildFlowRuntime } from './runtime.helper';
import { CascadeService } from '../cascade.service';
import { MapflowPatternService } from './mapflowPattern.service';

export interface RequestUser {
  sub: number;
  email: string;
  roleName: RoleName;
}

@Injectable()
export class MapflowService {
  constructor(
    private readonly persistence: PersistenceService,
    private readonly cascade: CascadeService,
    private readonly mapflowPattern: MapflowPatternService,
  ) {}

  // ─── Acceso a modelos ─────────────────────────────────────────────────────

  private async getMapflowModel(companyId: string) {
    return this.persistence.getTenantModel<MapflowModel>(
      companyId,
      'Mapflow',
      MapflowModelSchema,
    );
  }

  private async getRuntimeModel(companyId: string) {
    return this.persistence.getTenantModel<FlowRuntime>(
      companyId,
      'FlowRuntime',
      FlowRuntimeSchema,
    );
  }

  // ─── Queries privadas ─────────────────────────────────────────────────────

  private async findLatestRuntime(companyId: string, flowDefinitionId: string) {
    const model = await this.getRuntimeModel(companyId);
    return model
      .findOne({ flowDefinitionId, active: true })
      .sort({ version: -1 })
      .lean();
  }

  private async deactivateRuntimes(companyId: string, flowDefinitionId: string) {
    const model = await this.getRuntimeModel(companyId);
    return model.updateMany({ flowDefinitionId }, { active: false });
  }

  private async upsertRuntime(
    companyId: string,
    flowDefinitionId: string,
    map: any[],
  ) {
    const { nodes, startNode, hash } = buildFlowRuntime(map);
    const latest = await this.findLatestRuntime(companyId, flowDefinitionId);

    // Hash idéntico → sin cambios lógicos, reutiliza versión actual
    if (latest?.hash === hash) return latest;

    // Desactiva versiones anteriores antes de crear la nueva
    await this.deactivateRuntimes(companyId, flowDefinitionId);

    const model = await this.getRuntimeModel(companyId);
    const orm = new MongoOrmService<FlowRuntime>(model);

    return orm.create({
      company_id: companyId,
      flowDefinitionId,
      version: (latest?.version ?? 0) + 1,
      startNode,
      nodes,
      hash,
      active: true,
    });
  }

  // ─── Helper: indexado de pattern (solo admin) ────────────────────────────

  /**
   * Dispara la vectorización de `description` hacia la colección
   * `mapflow_pattern` de Qdrant. Solo aplica si el usuario es ADMIN
   * y vino `description` en el dto. No bloqueante (fire-and-forget),
   * delegado por completo a MapflowPatternService.
   */
  private maybeIndexPattern(
    user: RequestUser,
    mapflowId: string,
    companyId: string,
    description?: string,
  ): void {
    if (user.roleName !== RoleName.ADMIN) return;
    if (!description) return;

    this.mapflowPattern.indexPattern({
      mapflowId,
      tenant: companyId,
      description,
    });
  }

  /**
   * Igual que maybeIndexPattern pero para update: borra el punto anterior
   * (si existía) y crea uno nuevo, evitando duplicados/huérfanos para el
   * mismo mapflow_id.
   */
  private maybeReindexPattern(
    user: RequestUser,
    mapflowId: string,
    companyId: string,
    description?: string,
  ): void {
    if (user.roleName !== RoleName.ADMIN) return;
    if (!description) return;

    this.mapflowPattern.reindexPattern({
      mapflowId,
      tenant: companyId,
      description,
    });
  }

  /**
   * Limpieza del pattern en Qdrant. Solo aplica si el usuario es ADMIN.
   * No depende de que `description` haya sido seteada — si existía un
   * pattern previo, hay que borrarlo igual.
   */
  private maybeDeletePattern(user: RequestUser, mapflowId: string): void {
    if (user.roleName !== RoleName.ADMIN) return;
    this.mapflowPattern.deletePattern(mapflowId);
  }

  // ─── Público: Mapflows ────────────────────────────────────────────────────

  async createMapflow(companyId: string, dto: CreateMapflowDto, user: RequestUser) {
    const { map, ...uiData } = dto;
    const model = await this.getMapflowModel(companyId);
    const orm = new MongoOrmService<MapflowModel>(model);

    const flow = await orm.create({
      ...uiData,
      company_id: companyId,
      deleted: false,
      active: true,
    });

    const flowId = (flow as any)._id.toString();

    try {
      const runtime = await this.upsertRuntime(companyId, flowId, map);

      this.maybeIndexPattern(user, flowId, companyId, dto.description);

      return { flow, runtime };
    } catch (err) {
      // Compensación: si el runtime falla, elimina el flow para no dejarlo huérfano
      await orm.deleteById(flowId);
      throw err;
    }
  }

  async getMapflowsByCompany(companyId: string, includeDeleted = false) {
    const model = await this.getMapflowModel(companyId);
    const query: any = { company_id: companyId };
    if (!includeDeleted) query.deleted = false;
    return model.find(query).lean();
  }

  async getMapflowById(companyId: string, id: string, includeDeleted = false) {
    const model = await this.getMapflowModel(companyId);
    const query: any = { _id: id, company_id: companyId };
    if (!includeDeleted) query.deleted = false;

    const flow = await model.findOne(query).lean();
    if (!flow) {
      throw new NotFoundException({
        message: `No se encontró un mapflow con ID "${id}".`,
      });
    }

    return flow;
  }

  async updateMapflow(
    companyId: string,
    id: string,
    dto: UpdateMapflowDto,
    user: RequestUser,
  ) {
    const { map, ...uiData } = dto;
    const model = await this.getMapflowModel(companyId);
    const orm = new MongoOrmService<MapflowModel>(model);

    await this.getMapflowById(companyId, id);

    const flow = await orm.updateById(id, uiData as any);

    let runtime: Awaited<ReturnType<typeof this.upsertRuntime>> | null = null;
    if (map?.length) {
      runtime = await this.upsertRuntime(companyId, id, map);
    }

    this.maybeReindexPattern(user, id, companyId, dto.description);

    return { flow, runtime };
  }

  /**
   * Activa o desactiva un mapflow.
   *
   * Al desactivar: propaga la cascada hacia bots y widgets dependientes
   * antes de persistir el cambio en el propio mapflow.
   * cascade.onMapflowDeactivated ya llama internamente a deactivateMapflow,
   * por lo que no es necesario un updateById adicional aquí.
   *
   * Al activar: simplemente marca active=true. Los bots y widgets deben
   * reactivarse manualmente para evitar activaciones no supervisadas.
   */
  async toggleActive(companyId: string, id: string, active: boolean) {
    await this.getMapflowById(companyId, id);

    if (!active) {
      await this.cascade.onMapflowDeactivated(companyId, id);
      return { message: `Mapflow "${id}" desactivado junto con sus dependencias.` };
    }

    const model = await this.getMapflowModel(companyId);
    const orm = new MongoOrmService<MapflowModel>(model);
    return orm.updateById(id, { active: true } as any);
  }

  /**
   * Elimina un mapflow (soft o hard delete).
   *
   * Hard delete:
   *   1. Desanexa mapflowId de los bots que lo referenciaban
   *   2. Desactiva esos bots y sus widgets
   *   3. Elimina el mapflow físicamente (via cascade)
   *   4. Elimina todos los runtimes asociados
   *   5. (admin) elimina el pattern asociado en Qdrant
   *
   * Soft delete:
   *   1. Desactiva bots y widgets dependientes (via cascade)
   *   2. cascade.onMapflowRemoved(hard=false) desactiva el mapflow internamente
   *   3. Desactiva los runtimes del flow
   *   4. Marca el mapflow como deleted=true
   *   5. (admin) elimina el pattern asociado en Qdrant — un mapflow marcado
   *      como deleted no debería seguir usándose como referencia para
   *      autogeneración por LLM.
   */
  async deleteMapflow(
    companyId: string,
    id: string,
    user: RequestUser,
    hard = false,
  ) {
    // includeDeleted=true para permitir hard delete de registros ya soft-deleted
    await this.getMapflowById(companyId, id, true);

    this.maybeDeletePattern(user, id);

    if (hard) {
      await this.cascade.onMapflowRemoved(companyId, id, true);

      // Elimina todos los runtimes asociados
      const runtimeModel = await this.getRuntimeModel(companyId);
      await runtimeModel.deleteMany({ flowDefinitionId: id });

      return { message: `Mapflow "${id}" eliminado permanentemente.` };
    }

    // Soft delete
    await this.cascade.onMapflowRemoved(companyId, id, false);

    await this.deactivateRuntimes(companyId, id);

    const model = await this.getMapflowModel(companyId);
    const orm = new MongoOrmService<MapflowModel>(model);
    return orm.updateById(id, { deleted: true, active: false } as any);
  }

  // ─── Público: Runtime (para el engine) ───────────────────────────────────

  async getActiveRuntime(companyId: string, flowDefinitionId: string) {
    const runtime = await this.findLatestRuntime(companyId, flowDefinitionId);

    if (!runtime) {
      throw new NotFoundException({
        message: `No hay runtime activo para el flow "${flowDefinitionId}".`,
      });
    }

    return runtime;
  }

  async getRuntimesByFlow(companyId: string, flowDefinitionId: string) {
    const model = await this.getRuntimeModel(companyId);
    return model
      .find({ flowDefinitionId, company_id: companyId })
      .sort({ version: -1 })
      .lean();
  }
}