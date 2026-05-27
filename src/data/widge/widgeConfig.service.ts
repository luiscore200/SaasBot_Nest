import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import { WidgetConfigModel, WidgetConfigSchema } from '../../mongoose/widgetConfig.schema';
import { ChatbotModel, ChatbotSchema } from '../../mongoose/chatbot.schema';
import { CreateWidgetConfigDto } from './dto/create.dto';
import { UpdateWidgetConfigDto } from './dto/update.dto';

@Injectable()
export class WidgetConfigService {
  constructor(private readonly persistence: PersistenceService) {}

  // ─── Acceso a modelos ─────────────────────────────────────────────────────

  private async getModel(companyId: string) {
    return this.persistence.getTenantModel<WidgetConfigModel>(
      companyId,
      'WidgetConfig',
      WidgetConfigSchema,
    );
  }

  private async getBotModel(companyId: string) {
    return this.persistence.getTenantModel<ChatbotModel>(
      companyId,
      'BotConfig',
      ChatbotSchema,
    );
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateWidgetConfigDto) {
    // Verifica que el botConfig referenciado exista y esté activo
    await this.assertBotExists(companyId, dto.botConfigId);

    const model = await this.getModel(companyId);
    const orm = new MongoOrmService<WidgetConfigModel>(model);

    return orm.create({
      ...dto,
      company_id: companyId,
    });
  }

  async findAll(companyId: string, includeDeleted = false) {
    const model = await this.getModel(companyId);
    const query: any = { company_id: companyId };
    if (!includeDeleted) query.deleted = false;

    return model.find(query).lean();
  }

  async findById(companyId: string, id: string, includeDeleted = false) {
    const model = await this.getModel(companyId);
    const query: any = { _id: id, company_id: companyId };
    if (!includeDeleted) query.deleted = false;

    const doc = await model.findOne(query).lean();
    if (!doc) {
      throw new NotFoundException({
        message: `No se encontró un WidgetConfig con ID "${id}".`,
      });
    }

    return doc;
  }

  async update(companyId: string, id: string, dto: UpdateWidgetConfigDto) {
    await this.findById(companyId, id);

    // Si cambia el botConfigId, valida que el nuevo bot exista
    if (dto.botConfigId) {
      await this.assertBotExists(companyId, dto.botConfigId);
    }

    const model = await this.getModel(companyId);
    const orm = new MongoOrmService<WidgetConfigModel>(model);

    return orm.updateById(id, dto as Partial<WidgetConfigModel>);
  }

  async delete(companyId: string, id: string, hard = false) {
    await this.findById(companyId, id, true);

    const model = await this.getModel(companyId);
    const orm = new MongoOrmService<WidgetConfigModel>(model);

    if (hard) {
      return orm.deleteById(id);
    }

    return orm.updateById(id, { deleted: true, active: false } as any);
  }

  async toggleActive(companyId: string, id: string, active: boolean) {
    await this.findById(companyId, id);

    const model = await this.getModel(companyId);
    const orm = new MongoOrmService<WidgetConfigModel>(model);

    return orm.updateById(id, { active } as any);
  }

  // ─── Resolución para el script JS ────────────────────────────────────────

  /**
   * Endpoint público que consume el widget JS al inicializarse.
   * Devuelve únicamente los datos de UI necesarios para renderizar el widget
   * — no expone instrucciones del LLM ni IDs internos sensibles.
   */
  async resolveForWidget(widgetId: string, companyId: string) {
    const widget = await this.findById(companyId, widgetId);

    if (!widget.active) {
      throw new BadRequestException({
        message: 'Este widget está inactivo.',
      });
    }

    return {
      widgetId,
      displayName: widget.displayName,
      logoUrl: widget.logoUrl ?? null,
      primaryColor: widget.primaryColor,
      secondaryColor: widget.secondaryColor,
      position: widget.position,
      // botConfigId se incluye para que el script lo pase al engine
      // al iniciar una conversación — no expone config interna del bot
      botConfigId: widget.botConfigId,
    };
  }

  // ─── Guard privado ────────────────────────────────────────────────────────

  private async assertBotExists(companyId: string, botConfigId: string) {
    const botModel = await this.getBotModel(companyId);
    const bot = await botModel.findOne({ _id: botConfigId, deleted: false }).lean();

    if (!bot) {
      throw new NotFoundException({
        message: `No se encontró un BotConfig activo con ID "${botConfigId}".`,
      });
    }

    if (!bot.active) {
      throw new BadRequestException({
        message: `El BotConfig "${botConfigId}" está inactivo. Actívalo antes de asignarlo a un widget.`,
      });
    }
  }
}