import { Injectable, Logger } from '@nestjs/common';
import { PersistenceService } from '../common/services/percistence/persistence.service';
import { QdrantService } from '../qdrant/qdrant.service';
import { DocumentModel, DocumentModelSchema } from '../mongoose/documents.schema';
import { MapflowModel, MapflowModelSchema } from '../mongoose/mapflows.schema';
import { ChatbotModel, ChatbotSchema } from '../mongoose/chatbot.schema';
import { WidgetConfigModel, WidgetConfigSchema } from '../mongoose/widgetConfig.schema';

@Injectable()
export class CascadeService {
  private readonly logger = new Logger(CascadeService.name);

  constructor(
    private readonly persistence: PersistenceService,
    private readonly qdrant: QdrantService,
  ) {}

  // ─── Schema cascade ───────────────────────────────────────────────────────

  /**
   * Llamar desde SchemasService.deleteSchema() ANTES del delete real.
   * hard=true → elimina documentos y mapflows físicamente
   * hard=false → solo desactiva la cadena (no borra documentos)
   */
  async onSchemaRemoved(
    companyId: string,
    schemaId: string,
    hard: boolean,
  ): Promise<void> {
    if (hard) {
      await this.deleteDocumentsBySchema(companyId, schemaId);
      const mapflowIds = await this.getMapflowIdsBySchema(companyId, schemaId);
      for (const mapflowId of mapflowIds) {
        await this.onMapflowRemoved(companyId, mapflowId, true);
      }
    } else {
      await this.onSchemaDeactivated(companyId, schemaId);
    }
  }

  /**
   * Llamar desde SchemasService.toggleActive(false).
   * Desactiva mapflows, bots y widgets en cascada.
   * NO elimina documentos ni el schema en sí.
   */
  async onSchemaDeactivated(
    companyId: string,
    schemaId: string,
  ): Promise<void> {
    const mapflowIds = await this.getMapflowIdsBySchema(companyId, schemaId);
    for (const mapflowId of mapflowIds) {
      await this.onMapflowDeactivated(companyId, mapflowId);
    }
  }

  // ─── Mapflow cascade ──────────────────────────────────────────────────────

  async onMapflowRemoved(
    companyId: string,
    mapflowId: string,
    hard: boolean,
  ): Promise<void> {
    const botIds = await this.getBotIdsByMapflow(companyId, mapflowId);

    for (const botId of botIds) {
      await this.detachMapflowFromBot(companyId, botId);
      await this.onBotDeactivated(companyId, botId);
    }

    if (hard) {
      await this.hardDeleteMapflow(companyId, mapflowId);
    } else {
      await this.deactivateMapflow(companyId, mapflowId);
    }
  }

  async onMapflowDeactivated(
    companyId: string,
    mapflowId: string,
  ): Promise<void> {
    await this.deactivateMapflow(companyId, mapflowId);
    const botIds = await this.getBotIdsByMapflow(companyId, mapflowId);
    for (const botId of botIds) {
      await this.onBotDeactivated(companyId, botId);
    }
  }

  // ─── Bot cascade ──────────────────────────────────────────────────────────

  async onBotRemoved(companyId: string, botId: string): Promise<void> {
    await this.detachBotFromWidgets(companyId, botId);
    await this.deactivateWidgetsByBot(companyId, botId);
  }

  async onBotDeactivated(companyId: string, botId: string): Promise<void> {
    await this.deactivateBot(companyId, botId);
    await this.deactivateWidgetsByBot(companyId, botId);
  }

  // ─── Helpers: Documents ───────────────────────────────────────────────────

  private async deleteDocumentsBySchema(
    companyId: string,
    schemaId: string,
  ): Promise<void> {
    const docModel = await this.persistence.getTenantModel<DocumentModel>(
      companyId,
      'Document',
      DocumentModelSchema,
    );

    const docs = await docModel.find({ schema_id: schemaId }).lean();
    const ids = docs.map((d: any) => d._id.toString());

    if (ids.length === 0) return;

    await docModel.deleteMany({ schema_id: schemaId });

    for (const id of ids) {
      this.qdrant
        .delete('documents', {
          must: [{ key: 'document_id', match: { value: id } }],
        })
        .catch((err) =>
          this.logger.warn(`Qdrant: no se pudo eliminar doc="${id}": ${err.message}`),
        );
    }

    this.logger.log(
      `Cascade: eliminados ${ids.length} documentos del schema "${schemaId}"`,
    );
  }

  // ─── Helpers: Mapflows ────────────────────────────────────────────────────

  private async getMapflowIdsBySchema(
    companyId: string,
    schemaId: string,
  ): Promise<string[]> {
    const model = await this.persistence.getTenantModel<MapflowModel>(
      companyId,
      'Mapflow',
      MapflowModelSchema,
    );
    const flows = await model
      .find({ selectedSchemas: schemaId, deleted: false })
      .lean();
    return flows.map((f: any) => f._id.toString());
  }

  private async hardDeleteMapflow(
    companyId: string,
    mapflowId: string,
  ): Promise<void> {
    const model = await this.persistence.getTenantModel<MapflowModel>(
      companyId,
      'Mapflow',
      MapflowModelSchema,
    );
    await model.findByIdAndDelete(mapflowId);
    this.logger.log(`Cascade: mapflow "${mapflowId}" eliminado`);
  }

  private async deactivateMapflow(
    companyId: string,
    mapflowId: string,
  ): Promise<void> {
    const model = await this.persistence.getTenantModel<MapflowModel>(
      companyId,
      'Mapflow',
      MapflowModelSchema,
    );
    await model.findByIdAndUpdate(mapflowId, { active: false });
    this.logger.log(`Cascade: mapflow "${mapflowId}" desactivado`);
  }

  // ─── Helpers: Bots ────────────────────────────────────────────────────────

  private async getBotIdsByMapflow(
    companyId: string,
    mapflowId: string,
  ): Promise<string[]> {
    const model = await this.persistence.getTenantModel<ChatbotModel>(
      companyId,
      'BotConfig',
      ChatbotSchema,
    );
    const bots = await model.find({ mapflowId, deleted: false }).lean();
    return bots.map((b: any) => b._id.toString());
  }

  private async detachMapflowFromBot(
    companyId: string,
    botId: string,
  ): Promise<void> {
    const model = await this.persistence.getTenantModel<ChatbotModel>(
      companyId,
      'BotConfig',
      ChatbotSchema,
    );
    await model.findByIdAndUpdate(botId, { mapflowId: null });
    this.logger.log(`Cascade: mapflow desanexado del bot "${botId}"`);
  }

  private async deactivateBot(
    companyId: string,
    botId: string,
  ): Promise<void> {
    const model = await this.persistence.getTenantModel<ChatbotModel>(
      companyId,
      'BotConfig',
      ChatbotSchema,
    );
    await model.findByIdAndUpdate(botId, { active: false });
    this.logger.log(`Cascade: bot "${botId}" desactivado`);
  }

  // ─── Helpers: Widgets ─────────────────────────────────────────────────────

  private async deactivateWidgetsByBot(
    companyId: string,
    botId: string,
  ): Promise<void> {
    const model = await this.persistence.getTenantModel<WidgetConfigModel>(
      companyId,
      'WidgetConfig',
      WidgetConfigSchema,
    );
    const result = await model.updateMany(
      { botConfigId: botId, deleted: false },
      { active: false },
    );
    this.logger.log(
      `Cascade: ${result.modifiedCount} widget(s) desactivado(s) por bot "${botId}"`,
    );
  }

  private async detachBotFromWidgets(
    companyId: string,
    botId: string,
  ): Promise<void> {
    const model = await this.persistence.getTenantModel<WidgetConfigModel>(
      companyId,
      'WidgetConfig',
      WidgetConfigSchema,
    );
    await model.updateMany(
      { botConfigId: botId },
      { botConfigId: null, active: false },
    );
    this.logger.log(`Cascade: bot desanexado de widgets (bot="${botId}")`);
  }
}