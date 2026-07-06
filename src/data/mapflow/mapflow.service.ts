import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { RoleName } from '@prisma/client';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { MapflowModel, MapflowModelSchema } from '../../mongoose/mapflows.schema';
import { FlowRuntime, FlowRuntimeSchema } from 'src/mongoose/runtimes.schema';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import { CreateMapflowDto } from './dto/create-mapflow.dto';
import { UpdateMapflowDto } from './dto/update-mapflow.dto';
import { buildFlowRuntimeSkeleton, computeRuntimeHash, RuntimeNode } from './runtime.helper';
import { CascadeService } from '../cascade.service';
import { MapflowPatternService } from './mapflowPattern.service';
import { StoreEnrichmentService, PreviousStoreDescription } from './storeEnrichment.service';

export interface RequestUser {
  sub: number;
  email: string;
  roleName: RoleName;
}

@Injectable()
export class MapflowService {
  private readonly logger = new Logger(MapflowService.name);
  constructor(
    private readonly persistence: PersistenceService,
    private readonly cascade: CascadeService,
    private readonly mapflowPattern: MapflowPatternService,
    private readonly storeEnrichment: StoreEnrichmentService,
  ) {}

  // ─── Acceso a modelos ─────────────────────────────────────────────────────

  private async getMapflowModel(companyId: string) {
    return this.persistence.getTenantModel<MapflowModel>(companyId, 'Mapflow', MapflowModelSchema);
  }

  private async getRuntimeModel(companyId: string) {
    return this.persistence.getTenantModel<FlowRuntime>(companyId, 'FlowRuntime', FlowRuntimeSchema);
  }

  // ─── Queries privadas ─────────────────────────────────────────────────────

  private async findLatestRuntime(companyId: string, flowDefinitionId: string) {
    const model = await this.getRuntimeModel(companyId);
    return model.findOne({ flowDefinitionId, active: true }).sort({ version: -1 }).lean();
  }

  private async deactivateRuntimes(companyId: string, flowDefinitionId: string) {
    const model = await this.getRuntimeModel(companyId);
    return model.updateMany({ flowDefinitionId }, { active: false });
  }

  /**
   * Construye el skeleton, enriquece los storeNode (solo regenera los que
   * cambiaron respecto a la versión activa previa), y persiste una nueva
   * versión de runtime si el hash resultante difiere de la última activa.
   */
  private async upsertRuntime(
    companyId: string,
    flowDefinitionId: string,
    map: any[],
  ): Promise<{ runtime: any; enrichedNodes: Record<string, RuntimeNode> }> {
    const { nodes, startNode } = buildFlowRuntimeSkeleton(map);

    const latest = await this.findLatestRuntime(companyId, flowDefinitionId);
    const previousDescriptions = this.extractPreviousDescriptions(latest?.nodes as any);

    await this.storeEnrichment.enrich(nodes, startNode, previousDescriptions);

    const hash = computeRuntimeHash(nodes);

    if (latest?.hash === hash) {
      return { runtime: latest, enrichedNodes: nodes };
    }

    await this.deactivateRuntimes(companyId, flowDefinitionId);

    const model = await this.getRuntimeModel(companyId);
    const orm = new MongoOrmService<FlowRuntime>(model);

    const runtime = await orm.create({
      company_id: companyId,
      flowDefinitionId,
      version: (latest?.version ?? 0) + 1,
      startNode,
      nodes,
      hash,
      active: true,
    });

    return { runtime, enrichedNodes: nodes };
  }

  private extractPreviousDescriptions(
    previousNodes?: Record<string, any>,
  ): Record<string, PreviousStoreDescription> {
    if (!previousNodes) return {};
    const result: Record<string, PreviousStoreDescription> = {};
    for (const [id, node] of Object.entries(previousNodes)) {
      if ((node as any)?.type !== 'storeNode') continue;
      const d = (node as any).data ?? {};
      if (d.configHash && d.llmDescription) {
        result[id] = { configHash: d.configHash, llmDescription: d.llmDescription };
      }
    }
    return result;
  }

  /**
   * Propaga llmDescription/configHash generados hacia el canvas persistido
   * (FlowNode[] en la colección mapflows) — así el editor no necesita
   * re-inferir al reabrir el flow, y un guardado sin cambios en los stores
   * reutiliza el texto ya generado en el próximo ciclo.
   */
  private applyEnrichedStoreData(flowNodes: any[], enrichedNodes: Record<string, RuntimeNode>): void {
    for (const flowNode of flowNodes ?? []) {
      if (flowNode.type !== 'storeNode') continue;
      const enriched = enrichedNodes[flowNode.id];
      if (!enriched) continue;
      flowNode.data.llmDescription = enriched.data.llmDescription;
      flowNode.data.configHash     = enriched.data.configHash;
    }
  }

  // ─── Helper: indexado de pattern (solo admin) ────────────────────────────

  private maybeIndexPattern(
    user: RequestUser,
    mapflowId: string,
    runtimeId: string,
    companyId: string,
    description?: string,
  ): void {
    if (user.roleName !== RoleName.ADMIN) return;
    if (!description) return;
    this.mapflowPattern.indexPattern({ mapflowId, runtimeId, tenant: companyId, description });
  }

  private maybeReindexPattern(
    user: RequestUser,
    mapflowId: string,
    runtimeId: string,
    companyId: string,
    description?: string,
  ): void {
    if (user.roleName !== RoleName.ADMIN) return;
    if (!description) return;
    this.mapflowPattern.reindexPattern({ mapflowId, runtimeId, tenant: companyId, description });
  }

  private maybeDeletePattern(user: RequestUser, mapflowId: string): void {
    if (user.roleName !== RoleName.ADMIN) return;
    this.mapflowPattern.deletePattern(mapflowId);
  }

  // ─── Público: Mapflows ────────────────────────────────────────────────────

  /**
   * Orden invertido respecto a la versión anterior: el runtime (con los
   * stores ya enriquecidos) se construye ANTES de persistir el mapflow,
   * usando un _id pre-generado. Esto permite guardar el canvas ya con
   * llmDescription, y elimina el riesgo de mapflow huérfano — ya no hace
   * falta compensación si el runtime falla, porque el mapflow simplemente
   * no se llega a crear.
   */
async createMapflow(companyId: string, dto: CreateMapflowDto, user: RequestUser) {
    const { map, ...uiData } = dto;
    const flowId = new Types.ObjectId().toString();

    const { runtime, enrichedNodes } = await this.upsertRuntime(companyId, flowId, map);

    this.applyEnrichedStoreData(uiData.nodes, enrichedNodes);

    const model = await this.getMapflowModel(companyId);
    const orm = new MongoOrmService<MapflowModel>(model);

    try {
      const flow = await orm.create({
        ...uiData,
        _id: flowId,
        company_id: companyId,
        deleted: false,
        active: true,
      });

      this.maybeIndexPattern(user, flowId, String((runtime as any)._id), companyId, dto.description);

      return { flow, runtime };
    } catch (err) {
      // Compensación: el runtime ya se creó con flowDefinitionId=flowId,
      // pero el mapflow falló — hay que limpiar el runtime huérfano.
      // También se busca (defensivamente) cualquier mapflow parcial que
      // Mongo pudiera haber persistido pese al error (p.ej. fallo de
      // validación post-write en algún hook), aunque con este flujo no
      // debería existir.
      await this.compensateFailedCreate(companyId, flowId);
      throw err;
    }
  }

  /**
   * Limpieza best-effort tras un createMapflow fallido. No relanza errores
   * de la limpieza misma — si esto falla, se loguea pero se prioriza
   * propagar el error original que causó la falla real.
   */
  private async compensateFailedCreate(companyId: string, flowId: string): Promise<void> {
    try {
      const runtimeModel = await this.getRuntimeModel(companyId);
      const runtimeDeleted = await runtimeModel.deleteMany({ flowDefinitionId: flowId });

      const mapflowModel = await this.getMapflowModel(companyId);
      const mapflowDeleted = await mapflowModel.deleteOne({ _id: flowId });

      this.logger.warn?.(
        `[createMapflow] compensación tras fallo — flowId="${flowId}" ` +
        `runtimes eliminados=${runtimeDeleted.deletedCount} ` +
        `mapflows eliminados=${mapflowDeleted.deletedCount}`,
      );
    } catch (cleanupErr: any) {
      this.logger.error?.(
        `[createMapflow] la compensación también falló para flowId="${flowId}": ${cleanupErr.message}`,
      );
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
      throw new NotFoundException({ message: `No se encontró un mapflow con ID "${id}".` });
    }
    return flow;
  }

  async updateMapflow(companyId: string, id: string, dto: UpdateMapflowDto, user: RequestUser) {
    const { map, ...uiData } = dto;
    await this.getMapflowById(companyId, id);

    let runtimeResult: { runtime: any; enrichedNodes: Record<string, RuntimeNode> } | null = null;
    if (map?.length) {
      runtimeResult = await this.upsertRuntime(companyId, id, map);
      this.applyEnrichedStoreData(uiData.nodes, runtimeResult.enrichedNodes);
    }

    const model = await this.getMapflowModel(companyId);
    const orm = new MongoOrmService<MapflowModel>(model);
    const flow = await orm.updateById(id, uiData as any);

    if (runtimeResult) {
      this.maybeReindexPattern(
        user, id, String((runtimeResult.runtime as any)._id), companyId, dto.description,
      );
    }

    return { flow, runtime: runtimeResult?.runtime ?? null };
  }

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

  async deleteMapflow(companyId: string, id: string, user: RequestUser, hard = false) {
    await this.getMapflowById(companyId, id, true);

    this.maybeDeletePattern(user, id);

    if (hard) {
      await this.cascade.onMapflowRemoved(companyId, id, true);
      const runtimeModel = await this.getRuntimeModel(companyId);
      await runtimeModel.deleteMany({ flowDefinitionId: id });
      return { message: `Mapflow "${id}" eliminado permanentemente.` };
    }

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
      throw new NotFoundException({ message: `No hay runtime activo para el flow "${flowDefinitionId}".` });
    }
    return runtime;
  }

  async getRuntimesByFlow(companyId: string, flowDefinitionId: string) {
    const model = await this.getRuntimeModel(companyId);
    return model.find({ flowDefinitionId, company_id: companyId }).sort({ version: -1 }).lean();
  }
}