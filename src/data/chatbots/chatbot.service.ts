import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PersistenceService } from '../../common/services/percistence/persistence.service';
import { MongoOrmService } from '../../mongoose/mongoose.service';
import { ChatbotModel, ChatbotSchema, BotPlugin } from '../../mongoose/chatbot.schema';
import { CreateBotConfigDto } from './dto/create.dto';
import { UpdateBotConfigDto } from './dto/update.dto';
import { CascadeService } from '../cascade.service';

@Injectable()
export class ChatbotService {
  constructor(
    private readonly persistence: PersistenceService,
      private readonly cascade: CascadeService,   // ← añadir
  ) {}

  // ─── Acceso al modelo ─────────────────────────────────────────────────────

  private async getModel(companyId: string) {
    return this.persistence.getTenantModel<ChatbotModel>(
      companyId,
      'BotConfig',
      ChatbotSchema,
    );
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateBotConfigDto) {
    const model = await this.getModel(companyId);
    const orm = new MongoOrmService<ChatbotModel>(model);

    return orm.create({
      ...dto,
      company_id: companyId,
    });
  }

  async findAll(companyId: string, includeDeleted = false, plugin?: BotPlugin) {
    const model = await this.getModel(companyId);
    const query: any = { company_id: companyId };
    if (!includeDeleted) query.deleted = false;
    if (plugin) query.plugin = plugin;

    return model.find(query).lean();
  }

  async findById(companyId: string, id: string, includeDeleted = false) {
    const model = await this.getModel(companyId);
    const query: any = { _id: id, company_id: companyId };
    if (!includeDeleted) query.deleted = false;

    const doc = await model.findOne(query).lean();
    if (!doc) {
      throw new NotFoundException({
        message: `No se encontró un BotConfig con ID "${id}".`,
      });
    }

    return doc;
  }

  async update(companyId: string, id: string, dto: UpdateBotConfigDto) {
    await this.findById(companyId, id);

    const model = await this.getModel(companyId);
    const orm = new MongoOrmService<ChatbotModel>(model);

    return orm.updateById(id, dto as Partial<ChatbotModel>);
  }

 async delete(companyId: string, id: string, hard = false) {
  await this.findById(companyId, id, true);

  // ── Cascade ───────────────────────────────────────────────────────────
  await this.cascade.onBotRemoved(companyId, id);

  const model = await this.getModel(companyId);
  const orm = new MongoOrmService<ChatbotModel>(model);

  return hard
    ? orm.deleteById(id)
    : orm.updateById(id, { deleted: true, active: false } as any);
}

async toggleActive(companyId: string, id: string, active: boolean) {
  await this.findById(companyId, id);

  if (!active) {
    await this.cascade.onBotDeactivated(companyId, id);
    return;
  }

  const model = await this.getModel(companyId);
  const orm = new MongoOrmService<ChatbotModel>(model);
  return orm.updateById(id, { active: true } as any);
}
  // ─── Resolución para el engine ────────────────────────────────────────────

  /**
   * Devuelve el BotConfig activo resuelto para que el engine inicie
   * una sesión de conversación — incluye plugin para que el engine
   * adapte el formato de respuesta según el canal.
   */
  async resolveForEngine(companyId: string, botId: string) {
    const bot = await this.findById(companyId, botId);

    if (!bot.active) {
      throw new BadRequestException({
        message: `El bot "${botId}" está inactivo y no puede procesar conversaciones.`,
      });
    }

    return {
      botId: (bot as any)._id.toString(),
      plugin: bot.plugin,
      mapflowId: bot.mapflowId,
      type: bot.type,
      selectedSchemas: bot.selectedSchemas,
      systemContext: {
        description: bot.description,
        instructions: bot.instructions,
        maxTurns: bot.maxTurns,
      },
    };
  }
}