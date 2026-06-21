import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { WidgetConfigModel, WidgetConfigSchema } from '../../mongoose/widgetConfig.schema';

@Injectable()
export class WidgetCorsService implements OnModuleInit {
  private readonly logger = new Logger(WidgetCorsService.name);
  private allowedOrigins = new Set<string>();

  constructor(
    private readonly prisma:      PrismaService,
    private readonly persistence: PersistenceService,
  ) {}

  // ─── Precarga al arranque ─────────────────────────────────────────────────
  // Cada User con rol ADMIN es un tenant — su id es el company_id.
  // Se itera en paralelo sobre todos los tenants y se extraen
  // los allowedOrigins de sus WidgetConfig activos.

  async onModuleInit() {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.logger.log('[WidgetCors] Cargando origins desde todos los tenants...');

    try {
      // Todos los usuarios ADMIN = todos los tenants
      const admins = await this.prisma.user.findMany({
        where:  { role: { name: 'ADMIN' } },
        select: { id: true },
      });

      this.logger.log(`[WidgetCors] Tenants (admins) encontrados: ${admins.length}`);

      const fresh = new Set<string>();

      await Promise.all(
        admins.map(async (admin) => {
          try {
            const model = await this.persistence.getTenantModel<WidgetConfigModel>(
              String(admin.id),
              'WidgetConfig',
              WidgetConfigSchema,
            );

            const docs = await model
              .find({ active: true, deleted: false })
              .select('allowedOrigins')
              .lean();

            for (const doc of docs) {
              for (const origin of doc.allowedOrigins ?? []) {
                const normalized = origin?.trim().replace(/\/$/, '');
                if (normalized) fresh.add(normalized);
              }
            }
          } catch (err: any) {
            // Si un tenant falla no bloqueamos el resto
            this.logger.warn(
              `[WidgetCors] Error en tenant "${admin.id}": ${err.message}`,
            );
          }
        }),
      );

      this.allowedOrigins = fresh;
      this.logger.log(
        `[WidgetCors] Set cargado — ${fresh.size} origin(s): ${[...fresh].join(', ') || '(ninguno)'}`,
      );
    } catch (err: any) {
      this.logger.error(`[WidgetCors] Error en refresh(): ${err.message}`);
    }
  }

  // ─── Validación O(1) — llamada por CORS en cada request ──────────────────

  isAllowed(origin: string | undefined): boolean {
    if (!origin || origin === 'null') return true;   // file://, server-to-server
    if (this.isLocalhost(origin)) return true;        // desarrollo siempre OK
    return this.allowedOrigins.has(origin);
  }

  // ─── Mutaciones reactivas ─────────────────────────────────────────────────

  addOrigins(origins: string[]): void {
    const normalized = origins
      .map(o => o.trim().replace(/\/$/, ''))
      .filter(Boolean);
    for (const o of normalized) this.allowedOrigins.add(o);
    if (normalized.length) {
      this.logger.log(`[WidgetCors] Origins agregados: ${normalized.join(', ')}`);
    }
  }

  removeOrigins(origins: string[]): void {
    const normalized = origins.map(o => o.trim().replace(/\/$/, ''));
    for (const o of normalized) this.allowedOrigins.delete(o);
    if (normalized.length) {
      this.logger.log(`[WidgetCors] Origins removidos: ${normalized.join(', ')}`);
    }
  }

  getAll(): string[] {
    return [...this.allowedOrigins];
  }

  private isLocalhost(origin: string): boolean {
    return origin.includes('localhost') || origin.includes('127.0.0.1');
  }
}