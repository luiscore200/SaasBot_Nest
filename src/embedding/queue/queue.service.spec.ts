import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from './queue.service';
import { EmbeddingFieldJob } from '../embedding.types';

// ─── Helper ──────────────────────────────────────────────────────────────────

const makeFields = (names: string[]) =>
  names.map((name) => ({ name, type: 'string' }));

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QueueService],
    }).compile();

    service = module.get<QueueService>(QueueService);

    // Arrancar el loop interno manualmente (onModuleInit lo hace en runtime)
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  // ── Definición ──────────────────────────────────────────────────────────

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  // ── enqueueFields ────────────────────────────────────────────────────────

  describe('enqueueFields', () => {
    it('crea un job por cada campo', () => {
      const jobs = service.enqueueFields(
        'company1', 'schema1', 'Test Schema',
        makeFields(['nombre', 'precio', 'stock']),
      );

      expect(jobs).toHaveLength(3);
      expect(jobs.map((j) => j.fieldName)).toEqual(['nombre', 'precio', 'stock']);
    });

    it('cada job inicia en estado pending', () => {
      const jobs = service.enqueueFields(
        'company1', 'schema1', 'Test Schema',
        makeFields(['nombre']),
      );

      expect(jobs[0].status).toBe('pending');
      expect(jobs[0].attempts).toBe(0);
    });

    it('cada job tiene jobId único (UUID)', () => {
      const jobs = service.enqueueFields(
        'company1', 'schema1', 'Test Schema',
        makeFields(['a', 'b', 'c']),
      );

      const ids = jobs.map((j) => j.jobId);
      const unique = new Set(ids);
      expect(unique.size).toBe(3);
    });

    it('propaga schemaDescription al job', () => {
      const jobs = service.enqueueFields(
        'company1', 'schema1', 'Test Schema',
        makeFields(['campo']),
        'Descripción del schema',
      );

      expect(jobs[0].schemaDescription).toBe('Descripción del schema');
    });

    it('propaga description del campo al job', () => {
      const jobs = service.enqueueFields(
        'company1', 'schema1', 'Test Schema',
        [{ name: 'precio', type: 'number', description: 'precio en pesos' }],
      );

      expect(jobs[0].fieldDescription).toBe('precio en pesos');
    });

    it('no encola nada si fields está vacío', () => {
      const jobs = service.enqueueFields(
        'company1', 'schema1', 'Test Schema', [],
      );

      expect(jobs).toHaveLength(0);
      expect(service.getStats().queued).toBe(0);
    });
  });

  // ── getJob / updateJob ───────────────────────────────────────────────────

  describe('getJob / updateJob', () => {
    it('getJob retorna el job por id', () => {
      const [job] = service.enqueueFields(
        'c1', 's1', 'Schema', makeFields(['x']),
      );

      const found = service.getJob(job.jobId);
      expect(found).toBeDefined();
      expect(found!.fieldName).toBe('x');
    });

    it('getJob retorna undefined para id inexistente', () => {
      expect(service.getJob('no-existe')).toBeUndefined();
    });

    it('updateJob modifica solo los campos indicados', () => {
      const [job] = service.enqueueFields(
        'c1', 's1', 'Schema', makeFields(['x']),
      );

      service.updateJob(job.jobId, { status: 'llm_done', llmResult: 'desc' });

      const updated = service.getJob(job.jobId)!;
      expect(updated.status).toBe('llm_done');
      expect(updated.llmResult).toBe('desc');
      expect(updated.fieldName).toBe('x'); // no tocado
    });

    it('updateJob sobre id inexistente no lanza error', () => {
      expect(() =>
        service.updateJob('no-existe', { status: 'failed' }),
      ).not.toThrow();
    });
  });

  // ── getStats ─────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('refleja correctamente el estado de los jobs', () => {
      const [j1, j2] = service.enqueueFields(
        'c1', 's1', 'Schema', makeFields(['a', 'b']),
      );

      service.updateJob(j1.jobId, { status: 'qdrant_done' });
      service.updateJob(j2.jobId, { status: 'failed' });

      const stats = service.getStats();
      expect(stats.qdrant_done).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(0);
    });
  });

  // ── Registro del processor ───────────────────────────────────────────────

  describe('registerProcessor', () => {
    it('registra el processor sin lanzar error', () => {
      expect(() =>
        service.registerProcessor(async () => {}),
      ).not.toThrow();
    });

    it('el processor es llamado cuando hay jobs en cola', async () => {
      const processorMock = jest.fn().mockResolvedValue(undefined);
      service.registerProcessor(processorMock);

      service.enqueueFields('c1', 's1', 'Schema', makeFields(['campo']));

      // Esperar un tick del loop (500ms + margen)
      await new Promise((r) => setTimeout(r, 700));

      expect(processorMock).toHaveBeenCalledTimes(1);
      expect(processorMock.mock.calls[0][0].fieldName).toBe('campo');
    });

    it('no procesa jobs con status qdrant_done', async () => {
      const processorMock = jest.fn().mockResolvedValue(undefined);
      service.registerProcessor(processorMock);

      const [job] = service.enqueueFields(
        'c1', 's1', 'Schema', makeFields(['campo']),
      );
      service.updateJob(job.jobId, { status: 'qdrant_done' });

      await new Promise((r) => setTimeout(r, 700));

      expect(processorMock).not.toHaveBeenCalled();
    });
  });

  // ── Reintentos ───────────────────────────────────────────────────────────

  describe('reintentos y backoff', () => {
    it('reencola el job tras fallo con backoff', async () => {
      let callCount = 0;
      service.registerProcessor(async () => {
        callCount++;
        if (callCount === 1) throw new Error('fallo simulado');
      });

      service.enqueueFields('c1', 's1', 'Schema', makeFields(['x']));

      // Primer intento falla → reencola con 2s de delay
      await new Promise((r) => setTimeout(r, 700));
      expect(callCount).toBe(1);

      // Esperar reintento (2000ms backoff + margen)
      await new Promise((r) => setTimeout(r, 2500));
      expect(callCount).toBe(2);
    }, 10000);

    it('marca el job como failed tras maxAttempts', async () => {
      service.registerProcessor(async () => {
        throw new Error('siempre falla');
      });

      const [job] = service.enqueueFields(
        'c1', 's1', 'Schema', makeFields(['x']),
      );

      // Esperar suficiente para 3 intentos (1er intento + 2s + 4s + margen)
      await new Promise((r) => setTimeout(r, 8000));

      const finalJob = service.getJob(job.jobId)!;
      expect(finalJob.status).toBe('failed');
      expect(finalJob.attempts).toBe(3);
      expect(finalJob.lastError).toBe('siempre falla');
    }, 15000);
  });
});