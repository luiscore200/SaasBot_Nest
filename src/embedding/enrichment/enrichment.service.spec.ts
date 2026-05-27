import { Test, TestingModule } from '@nestjs/testing';
import { EnrichmentService } from './enrichment.service';
import { QueueService } from '../queue/queue.service';
import { EmbeddingFieldJob } from '../embedding.types';

// ─── Mock de QueueService ────────────────────────────────────────────────────

const mockQueueService = {
  enqueueFields: jest.fn(),
  getStats: jest.fn(),
  getJob: jest.fn(),
};

// ─── Helper ──────────────────────────────────────────────────────────────────

const makeSchema = (overrides = {}) => ({
  _id: 'schema-id-1',
  company_id: 'company-1',
  name: 'Inventario de prueba',
  description: 'Schema para tests',
  fields: [
    { name: 'nombre', type: 'string' },
    { name: 'precio', type: 'number' },
  ],
  ...overrides,
});

const makeJob = (overrides: Partial<EmbeddingFieldJob> = {}): EmbeddingFieldJob => ({
  jobId: 'job-uuid-1',
  schemaId: 'schema-id-1',
  companyId: 'company-1',
  schemaName: 'Inventario de prueba',
  fieldName: 'nombre',
  fieldType: 'string',
  status: 'pending',
  attempts: 0,
  maxAttempts: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('EnrichmentService', () => {
  let service: EnrichmentService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockQueueService.enqueueFields.mockReturnValue([makeJob(), makeJob({ jobId: 'job-uuid-2', fieldName: 'precio' })]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrichmentService,
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();

    service = module.get<EnrichmentService>(EnrichmentService);
  });

  // ── Definición ──────────────────────────────────────────────────────────

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  // ── enrichSchema ─────────────────────────────────────────────────────────

  describe('enrichSchema', () => {
    it('llama a enqueueFields con los datos correctos del schema', () => {
      const schema = makeSchema();
      service.enrichSchema(schema);

      expect(mockQueueService.enqueueFields).toHaveBeenCalledWith(
        'company-1',
        'schema-id-1',
        'Inventario de prueba',
        schema.fields,
        'Schema para tests',
      );
    });

    it('llama a enqueueFields una sola vez por schema', () => {
      service.enrichSchema(makeSchema());
      expect(mockQueueService.enqueueFields).toHaveBeenCalledTimes(1);
    });

    it('funciona cuando el schema no tiene description', () => {
      const schema = makeSchema({ description: undefined });
      expect(() => service.enrichSchema(schema)).not.toThrow();

      expect(mockQueueService.enqueueFields).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        undefined,
      );
    });

    it('funciona con un solo campo', () => {
      const schema = makeSchema({ fields: [{ name: 'id', type: 'number' }] });
      mockQueueService.enqueueFields.mockReturnValue([makeJob()]);

      expect(() => service.enrichSchema(schema)).not.toThrow();
      expect(mockQueueService.enqueueFields).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        [{ name: 'id', type: 'number' }],
        expect.anything(),
      );
    });
  });

  // ── enrichUpdatedFields ──────────────────────────────────────────────────

  describe('enrichUpdatedFields', () => {
    const schemaRef = {
      _id: 'schema-id-1',
      company_id: 'company-1',
      name: 'Inventario de prueba',
      description: 'Schema para tests',
    };

    it('encola solo los campos actualizados', () => {
      const updatedFields = [{ name: 'precio', type: 'number' }];
      service.enrichUpdatedFields(schemaRef, updatedFields);

      expect(mockQueueService.enqueueFields).toHaveBeenCalledWith(
        'company-1',
        'schema-id-1',
        'Inventario de prueba',
        updatedFields,
        'Schema para tests',
      );
    });

    it('no llama a enqueueFields si updatedFields está vacío', () => {
      service.enrichUpdatedFields(schemaRef, []);
      expect(mockQueueService.enqueueFields).not.toHaveBeenCalled();
    });

    it('no llama a enqueueFields si updatedFields es undefined', () => {
      service.enrichUpdatedFields(schemaRef, undefined as any);
      expect(mockQueueService.enqueueFields).not.toHaveBeenCalled();
    });

    it('encola múltiples campos actualizados correctamente', () => {
      const updatedFields = [
        { name: 'nombre', type: 'string' },
        { name: 'talla', type: 'string' },
        { name: 'stock', type: 'number' },
      ];
      mockQueueService.enqueueFields.mockReturnValue(
        updatedFields.map((f) => makeJob({ fieldName: f.name })),
      );

      service.enrichUpdatedFields(schemaRef, updatedFields);

      expect(mockQueueService.enqueueFields).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        updatedFields,
        expect.anything(),
      );
    });
  });

  // ── getQueueStats ────────────────────────────────────────────────────────

  describe('getQueueStats', () => {
    it('delega en QueueService.getStats', () => {
      const mockStats = { pending: 2, llm_done: 1, mongo_done: 0, qdrant_done: 3, failed: 0, queued: 2 };
      mockQueueService.getStats.mockReturnValue(mockStats);

      const result = service.getQueueStats();

      expect(mockQueueService.getStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStats);
    });
  });

  // ── getJobStatus ─────────────────────────────────────────────────────────

  describe('getJobStatus', () => {
    it('retorna el job cuando existe', () => {
      const job = makeJob({ status: 'llm_done' });
      mockQueueService.getJob.mockReturnValue(job);

      const result = service.getJobStatus('job-uuid-1');

      expect(mockQueueService.getJob).toHaveBeenCalledWith('job-uuid-1');
      expect(result).toEqual(job);
    });

    it('retorna undefined cuando el job no existe', () => {
      mockQueueService.getJob.mockReturnValue(undefined);

      const result = service.getJobStatus('no-existe');
      expect(result).toBeUndefined();
    });
  });
});