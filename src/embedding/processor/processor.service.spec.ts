import { Test, TestingModule } from '@nestjs/testing';
import { ProcessorService } from './processor.service';
import { QueueService } from '../queue/queue.service';
import { GroqService } from '../../groq/groq.service';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { EmbeddingFieldJob } from '../embedding.types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueueService = {
  registerProcessor: jest.fn(),
  updateJob: jest.fn(),
  getJob: jest.fn(),
};

const mockGroqService = {
  chatStructured: jest.fn(),
};

const mockModel = {
  updateOne: jest.fn(),
};

const mockPersistenceService = {
  getTenantModel: jest.fn().mockResolvedValue(mockModel),
};

// ─── Helper ──────────────────────────────────────────────────────────────────

const makeJob = (overrides: Partial<EmbeddingFieldJob> = {}): EmbeddingFieldJob => ({
  jobId: 'job-1',
  schemaId: 'schema-1',
  companyId: 'company-1',
  schemaName: 'Inventario farmacéutico',
  schemaDescription: 'Schema para medicamentos',
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

describe('ProcessorService', () => {
  let service: ProcessorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // getJob devuelve el job actualizado tras updateJob
    mockQueueService.getJob.mockImplementation((id: string) => makeJob({ jobId: id }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcessorService,
        { provide: QueueService,       useValue: mockQueueService },
        { provide: GroqService,        useValue: mockGroqService },
        { provide: PersistenceService, useValue: mockPersistenceService },
      ],
    }).compile();

    service = module.get<ProcessorService>(ProcessorService);
  });

  // ── Definición ──────────────────────────────────────────────────────────

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  // ── onModuleInit ─────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('registra el processor en la cola', () => {
      service.onModuleInit();
      expect(mockQueueService.registerProcessor).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });
  });

  // ── process — flujo completo ─────────────────────────────────────────────

  describe('process — flujo completo (pending → qdrant_done)', () => {
    beforeEach(() => {
      // LLM responde correctamente
      mockGroqService.chatStructured.mockResolvedValue({
        data: { fieldName: 'nombre', description: 'nombre del medicamento' },
        raw: { content: '{}' },
      });

      // Mongo confirma la actualización
      mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });

      // getJob simula avance de estado tras cada updateJob
      let state = 'pending';
      mockQueueService.updateJob.mockImplementation((_id: string, patch: any) => {
        if (patch.status) state = patch.status;
      });
      mockQueueService.getJob.mockImplementation(() => makeJob({ status: state as any, llmResult: 'nombre del medicamento' }));
    });

    it('llama al LLM, guarda en Mongo y completa el job', async () => {
      await service.process(makeJob());

      expect(mockGroqService.chatStructured).toHaveBeenCalledTimes(1);
      expect(mockModel.updateOne).toHaveBeenCalledTimes(1);
      expect(mockQueueService.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'llm_done' }));
      expect(mockQueueService.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'mongo_done' }));
      expect(mockQueueService.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'qdrant_done' }));
    });

    it('guarda llmResult en el job ANTES de tocar Mongo', async () => {
      const updateCalls: any[] = [];
      mockQueueService.updateJob.mockImplementation((_id: string, patch: any) => {
        updateCalls.push(patch);
      });

      await service.process(makeJob());

      const llmDoneCall = updateCalls.find((c) => c.status === 'llm_done');
      expect(llmDoneCall?.llmResult).toBe('nombre del medicamento');
      // llmResult se guarda ANTES del updateOne de Mongo
      const llmDoneIndex = updateCalls.indexOf(llmDoneCall);
      expect(llmDoneIndex).toBeLessThan(updateCalls.length - 1);
    });
  });

  // ── process — reanudación desde llm_done ────────────────────────────────

  describe('process — reanudación desde llm_done (no rellamada al LLM)', () => {
    it('salta el LLM si el job ya tiene llmResult', async () => {
      mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });

      let state = 'llm_done';
      mockQueueService.updateJob.mockImplementation((_id: string, patch: any) => {
        if (patch.status) state = patch.status;
      });
      mockQueueService.getJob.mockImplementation(() =>
        makeJob({ status: state as any, llmResult: 'descripción previa' }),
      );

      await service.process(makeJob({ status: 'llm_done', llmResult: 'descripción previa' }));

      expect(mockGroqService.chatStructured).not.toHaveBeenCalled();
      expect(mockModel.updateOne).toHaveBeenCalledTimes(1);
    });
  });

  // ── process — reanudación desde mongo_done ───────────────────────────────

  describe('process — reanudación desde mongo_done (solo Qdrant)', () => {
    it('salta LLM y Mongo si el job ya está en mongo_done', async () => {
      mockQueueService.getJob.mockReturnValue(
        makeJob({ status: 'qdrant_done' }),
      );

      await service.process(makeJob({ status: 'mongo_done', llmResult: 'desc' }));

      expect(mockGroqService.chatStructured).not.toHaveBeenCalled();
      expect(mockModel.updateOne).not.toHaveBeenCalled();
      expect(mockQueueService.updateJob).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ status: 'qdrant_done' }),
      );
    });
  });

  // ── generateDescription — validaciones ──────────────────────────────────

  describe('generateDescription — casos de error', () => {
    it('lanza error si el LLM devuelve descripción vacía', async () => {
      mockGroqService.chatStructured.mockResolvedValue({
        data: { fieldName: 'nombre', description: '' },
        raw: {},
      });

      await expect(service.process(makeJob())).rejects.toThrow(
        /descripción vacía/,
      );
    });

    it('lanza error si el LLM devuelve descripción undefined', async () => {
      mockGroqService.chatStructured.mockResolvedValue({
        data: { fieldName: 'nombre', description: undefined },
        raw: {},
      });

      await expect(service.process(makeJob())).rejects.toThrow(
        /descripción vacía/,
      );
    });

    it('lanza error si el LLM devuelve fieldName incorrecto (mismatch)', async () => {
      mockGroqService.chatStructured.mockResolvedValue({
        data: { fieldName: 'precio', description: 'descripción válida' }, // ← campo equivocado
        raw: {},
      });

      await expect(service.process(makeJob({ fieldName: 'nombre' }))).rejects.toThrow(
        /Mismatch de campo/,
      );
    });

    it('acepta la respuesta si el LLM no devuelve fieldName (campo omitido)', async () => {
      mockGroqService.chatStructured.mockResolvedValue({
        data: { description: 'descripción válida' }, // sin fieldName
        raw: {},
      });
      mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });
      mockQueueService.getJob.mockReturnValue(
        makeJob({ status: 'mongo_done', llmResult: 'descripción válida' }),
      );

      await expect(service.process(makeJob())).resolves.not.toThrow();
    });
  });

  // ── saveToMongo — validaciones ───────────────────────────────────────────

  describe('saveToMongo — casos de error', () => {
    beforeEach(() => {
      mockGroqService.chatStructured.mockResolvedValue({
        data: { fieldName: 'nombre', description: 'desc válida' },
        raw: {},
      });
    });

    it('lanza error si Mongo no encuentra el schema/campo (matchedCount 0)', async () => {
      mockModel.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(service.process(makeJob())).rejects.toThrow(
        /No se encontró schema/,
      );
    });

    it('usa el operador posicional $ con el fieldName exacto', async () => {
      mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });
      mockQueueService.getJob.mockReturnValue(
        makeJob({ status: 'mongo_done', llmResult: 'desc válida' }),
      );

      await service.process(makeJob());

      expect(mockModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ 'fields.name': 'nombre' }),
        expect.objectContaining({ $set: { 'fields.$.description': expect.any(String) } }),
      );
    });

    it('pasa el companyId correcto a getTenantModel', async () => {
      mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });
      mockQueueService.getJob.mockReturnValue(
        makeJob({ status: 'mongo_done', llmResult: 'desc' }),
      );

      await service.process(makeJob({ companyId: 'empresa-xyz' }));

      expect(mockPersistenceService.getTenantModel).toHaveBeenCalledWith(
        'empresa-xyz',
        'Schema',
        expect.anything(),
      );
    });
  });

  // ── buildPrompt ──────────────────────────────────────────────────────────

  describe('buildPrompt — contenido del prompt', () => {
    it('incluye el nombre del schema en el prompt', async () => {
      mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });
      mockGroqService.chatStructured.mockResolvedValue({
        data: { fieldName: 'nombre', description: 'desc' },
        raw: {},
      });
      mockQueueService.getJob.mockReturnValue(
        makeJob({ status: 'mongo_done', llmResult: 'desc' }),
      );

      await service.process(makeJob({ schemaName: 'Inventario farmacéutico' }));

      const promptArg = mockGroqService.chatStructured.mock.calls[0][0][0].content;
      expect(promptArg).toContain('Inventario farmacéutico');
    });

    it('incluye la descripción del schema si existe', async () => {
      mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });
      mockGroqService.chatStructured.mockResolvedValue({
        data: { fieldName: 'nombre', description: 'desc' },
        raw: {},
      });
      mockQueueService.getJob.mockReturnValue(
        makeJob({ status: 'mongo_done', llmResult: 'desc' }),
      );

      await service.process(makeJob({ schemaDescription: 'Schema de medicamentos' }));

      const promptArg = mockGroqService.chatStructured.mock.calls[0][0][0].content;
      expect(promptArg).toContain('Schema de medicamentos');
    });

    it('omite la línea de descripción del schema si no existe', async () => {
      mockModel.updateOne.mockResolvedValue({ matchedCount: 1 });
      mockGroqService.chatStructured.mockResolvedValue({
        data: { fieldName: 'nombre', description: 'desc' },
        raw: {},
      });
      mockQueueService.getJob.mockReturnValue(
        makeJob({ status: 'mongo_done', llmResult: 'desc' }),
      );

      await service.process(makeJob({ schemaDescription: undefined }));

      const promptArg = mockGroqService.chatStructured.mock.calls[0][0][0].content;
      expect(promptArg).not.toContain('Descripción del schema');
    });
  });
});