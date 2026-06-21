import {
  Injectable, NotFoundException, BadRequestException,
  UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import { WidgetConfigModel, WidgetConfigSchema } from '../../mongoose/widgetConfig.schema';
import { ChatbotModel, ChatbotSchema } from '../../mongoose/chatbot.schema';
import { CreateWidgetConfigDto } from './dto/create.dto';
import { UpdateWidgetConfigDto } from './dto/update.dto';
import { WidgetCorsService } from './widgetCors.service';

export interface WidgetTokenPayload {
  wid: string;
  cid: string;
}

@Injectable()
export class WidgetConfigService {
  constructor(
    private readonly persistence:      PersistenceService,
    private readonly configService:    ConfigService,
    private readonly jwtService:       JwtService,
    private readonly widgetCorsService: WidgetCorsService,
  ) {}

  // ─── Token opaco ──────────────────────────────────────────────────────────

  generateWidgetToken(widgetId: string, companyId: string): string {
    const payload: WidgetTokenPayload = { wid: widgetId, cid: companyId };
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
    });
  }

  verifyWidgetToken(token: string): WidgetTokenPayload {
    try {
      return this.jwtService.verify<WidgetTokenPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Widget token inválido.');
    }
  }

  // ─── Snippet ──────────────────────────────────────────────────────────────

  private buildSnippet(widgetId: string, companyId: string): string {
    const base  = this.configService.get<string>('API_BASE_URL') ?? 'http://localhost:3000';
    const token = this.generateWidgetToken(widgetId, companyId);
    return `<script src="${base}/widget/v?t=${token}" defer></script>`;
  }

  private withSnippet<T extends { _id: any; company_id: string }>(doc: T) {
    return { ...doc, snippet: this.buildSnippet(String(doc._id), doc.company_id) };
  }

  // ─── Modelos ──────────────────────────────────────────────────────────────

  private async getModel(companyId: string) {
    return this.persistence.getTenantModel<WidgetConfigModel>(
      companyId, 'WidgetConfig', WidgetConfigSchema,
    );
  }

  private async getBotModel(companyId: string) {
    return this.persistence.getTenantModel<ChatbotModel>(
      companyId, 'BotConfig', ChatbotSchema,
    );
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateWidgetConfigDto) {
    await this.assertBotExists(companyId, dto.botConfigId);

    const model = await this.getModel(companyId);
    const orm   = new MongoOrmService<WidgetConfigModel>(model);
    const doc   = await orm.create({ ...dto, company_id: companyId });

    // Registrar los nuevos origins en CORS sin recargar toda la DB
    if (dto.allowedOrigins?.length) {
      this.widgetCorsService.addOrigins(dto.allowedOrigins);
    }

    return this.withSnippet(doc.toObject());
  }

  async findAll(companyId: string, includeDeleted = false) {
    const model = await this.getModel(companyId);
    const query: any = { company_id: companyId };
    if (!includeDeleted) query.deleted = false;

    const docs = await model.find(query).lean();
    return docs.map(doc => this.withSnippet(doc));
  }

  async findById(companyId: string, id: string, includeDeleted = false) {
    const model = await this.getModel(companyId);
    const query: any = { _id: id, company_id: companyId };
    if (!includeDeleted) query.deleted = false;

    const doc = await model.findOne(query).lean();
    if (!doc) throw new NotFoundException({ message: `WidgetConfig "${id}" no encontrado.` });

    return this.withSnippet(doc);
  }

  async update(companyId: string, id: string, dto: UpdateWidgetConfigDto) {
    const before = await this.findById(companyId, id);

    if (dto.botConfigId) await this.assertBotExists(companyId, dto.botConfigId);

    const model = await this.getModel(companyId);
    const orm   = new MongoOrmService<WidgetConfigModel>(model);
    const doc   = await orm.updateById(id, dto as Partial<WidgetConfigModel>);

    // Si cambiaron los allowedOrigins: quitar los viejos, agregar los nuevos
    if (dto.allowedOrigins) {
      const oldOrigins = (before as any).allowedOrigins ?? [];
      this.widgetCorsService.removeOrigins(oldOrigins);
      this.widgetCorsService.addOrigins(dto.allowedOrigins);
    }

    return this.withSnippet((doc as any).toObject?.() ?? doc);
  }

  async delete(companyId: string, id: string, hard = false) {
    const widget = await this.findById(companyId, id, true);

    const model = await this.getModel(companyId);
    const orm   = new MongoOrmService<WidgetConfigModel>(model);

    // Al eliminar, quitar sus origins del Set CORS
    const origins = (widget as any).allowedOrigins ?? [];
    this.widgetCorsService.removeOrigins(origins);

    if (hard) return orm.deleteById(id);
    return orm.updateById(id, { deleted: true, active: false } as any);
  }

  async toggleActive(companyId: string, id: string, active: boolean) {
    const widget = await this.findById(companyId, id);

    const model = await this.getModel(companyId);
    const orm   = new MongoOrmService<WidgetConfigModel>(model);

    const origins = (widget as any).allowedOrigins ?? [];

    // Si se desactiva → quitar origins; si se activa → agregarlos
    if (!active) {
      this.widgetCorsService.removeOrigins(origins);
    } else {
      this.widgetCorsService.addOrigins(origins);
    }

    return orm.updateById(id, { active } as any);
  }

  // ─── Resolución pública para el loader.js ────────────────────────────────

  async resolveForWidget(token: string) {
    const { wid, cid } = this.verifyWidgetToken(token);
    const widget = await this.findById(cid, wid);

    if (!widget.active) throw new BadRequestException('Este widget está inactivo.');

    // La validación de origin ya la hizo CORS antes de llegar aquí
    return {
      widgetId:       wid,
      displayName:    widget.displayName,
      logoUrl:        widget.logoUrl ?? null,
      primaryColor:   widget.primaryColor,
      secondaryColor: widget.secondaryColor,
      position:       widget.position,
      botConfigId:    widget.botConfigId,
      companyId:      cid,
    };
  }

  // ─── Guard privado ────────────────────────────────────────────────────────

  private async assertBotExists(companyId: string, botConfigId: string) {
    const botModel = await this.getBotModel(companyId);
    const bot = await botModel.findOne({ _id: botConfigId, deleted: false }).lean();

    if (!bot) throw new NotFoundException({ message: `BotConfig "${botConfigId}" no encontrado.` });
    if (!bot.active) throw new BadRequestException({ message: `BotConfig "${botConfigId}" está inactivo.` });
  }
}