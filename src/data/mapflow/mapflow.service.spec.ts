import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MapflowService } from './mapflow.service';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import { CascadeService } from '../cascade.service';
import * as runtimeHelper from './runtime.helper';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const COMPANY    = 'company-1';
const FLOW_ID    = 'flow-1';
const RUNTIME_ID = 'runtime-1';

const FLOW_STUB = {
  _id: FLOW_ID,
  company_id: COMPANY,
  name: 'Mi Flow',
  active: true,
  deleted: false,
};

const RUNTIME_STUB = {
  _id: RUNTIME_ID,
  flowDefinitionId: FLOW_ID,
  version: 1,
  active: true,
  hash: 'hash-abc',
  startNode: 'node-1',
  nodes: {},
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mongoose query builder falso que termina en .lean() */
function leanQuery(result: any) {
  return { lean: () => Promise.resolve(result) };
}

/** Mongoose query builder falso que termina en .sort().lean() */
function sortLeanQuery(result: any) {
  return { sort: () => leanQuery(result) };
}

/**
 * Crea un modelo Mongoose falso.
 * find/findOne devuelven un builder con .lean()
 * updateMany y deleteMany resuelven directamente.
 */
function makeFlowModel(flowStub = FLOW_STUB) {
  const findOneSpy   = jest.fn().mockReturnValue(leanQuery(flowStub));
  const findSpy      = jest.fn().mockReturnValue(leanQuery([flowStub]));
  const updateManySpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const deleteManySpy = jest.fn().mockResolvedValue(null);

  return {
    findOne:     findOneSpy,
    find:        findSpy,
    updateMany:  updateManySpy,
    deleteMany:  deleteManySpy,
    // Los ORM helpers los mockeamos en la factory de ORM abajo
    _findOneSpy: findOneSpy,
  };
}

function makeRuntimeModel(runtimeStub = RUNTIME_STUB) {
  const findOneSpy   = jest.fn().mockReturnValue(sortLeanQuery(runtimeStub));
  const findSpy      = jest.fn().mockReturnValue(sortLeanQuery([runtimeStub]));
  const updateManySpy = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const deleteManySpy = jest.fn().mockResolvedValue(null);

  return {
    findOne:    findOneSpy,
    find:       findSpy,
    updateMany: updateManySpy,
    deleteMany: deleteManySpy,
  };
}

/** ORM falso que usa los modelos de arriba */
function makeOrmMock(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    create:     jest.fn().mockResolvedValue(FLOW_STUB),
    updateById: jest.fn().mockResolvedValue(FLOW_STUB),
    deleteById: jest.fn().mockResolvedValue(FLOW_STUB),
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

describe('MapflowService', () => {
  let service: MapflowService;
  let persistence: jest.Mocked<PersistenceService>;
  let cascade: jest.Mocked<CascadeService>;
  let flowModel: ReturnType<typeof makeFlowModel>;
  let runtimeModel: ReturnType<typeof makeRuntimeModel>;
  let ormMock: ReturnType<typeof makeOrmMock>;

  beforeEach(async () => {
    flowModel    = makeFlowModel();
    runtimeModel = makeRuntimeModel();
    ormMock      = makeOrmMock();

    // buildFlowRuntime lo mockeamos globalmente para no necesitar lógica real
    jest.spyOn(runtimeHelper, 'buildFlowRuntime').mockReturnValue({
      nodes: {},
      startNode: 'node-1',
      hash: 'hash-abc',
    });

    persistence = {
      getTenantModel: jest.fn().mockImplementation(
        (_cid: string, name: string) => {
          if (name === 'Mapflow')     return Promise.resolve(flowModel);
          if (name === 'FlowRuntime') return Promise.resolve(runtimeModel);
          return Promise.resolve({});
        },
      ),
    } as any;

    cascade = {
      onMapflowRemoved:     jest.fn().mockResolvedValue(undefined),
      onMapflowDeactivated: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Mock de MongoOrmService a nivel de módulo
    jest.mock('src/mongoose/mongoose.service', () => ({
      MongoOrmService: jest.fn().mockImplementation(() => ormMock),
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MapflowService,
        { provide: PersistenceService, useValue: persistence },
        { provide: CascadeService,     useValue: cascade },
      ],
    }).compile();

    service = module.get<MapflowService>(MapflowService);
  });

  afterEach(() => jest.restoreAllMocks());

  // ─── createMapflow ─────────────────────────────────────────────────────────

  describe('createMapflow', () => {
    const dto = { name: 'Flow Test', map: [{ id: 'node-1' }] };

    it('crea el flow y su runtime', async () => {
      ormMock.create.mockResolvedValue({ ...FLOW_STUB, _id: FLOW_ID });
      // Nuevo runtime (hash distinto al stored)
      runtimeModel.findOne.mockReturnValue(sortLeanQuery(null));

      const result = await service.createMapflow(COMPANY, dto as any);

      expect(ormMock.create).toHaveBeenCalled();
      expect(result).toHaveProperty('flow');
      expect(result).toHaveProperty('runtime');
    });

    it('hace rollback del flow si el runtime falla', async () => {
      ormMock.create.mockResolvedValue({ ...FLOW_STUB, _id: FLOW_ID });
      runtimeModel.findOne.mockReturnValue(sortLeanQuery(null));
      // Simula fallo al crear runtime
      ormMock.create
        .mockResolvedValueOnce({ ...FLOW_STUB, _id: FLOW_ID }) // primer create = flow
        .mockRejectedValueOnce(new Error('Fallo runtime'));     // segundo create = runtime

      await expect(
        service.createMapflow(COMPANY, dto as any),
      ).rejects.toThrow('Fallo runtime');

      expect(ormMock.deleteById).toHaveBeenCalledWith(FLOW_ID);
    });
  });

  // ─── getMapflowsByCompany ──────────────────────────────────────────────────

  describe('getMapflowsByCompany', () => {
    it('filtra deleted=false por defecto', async () => {
      await service.getMapflowsByCompany(COMPANY);
      expect(flowModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ deleted: false }),
      );
    });

    it('no filtra deleted si includeDeleted=true', async () => {
      await service.getMapflowsByCompany(COMPANY, true);
      const callArg = flowModel.find.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('deleted');
    });
  });

  // ─── getMapflowById ────────────────────────────────────────────────────────

  describe('getMapflowById', () => {
    it('devuelve el flow cuando existe', async () => {
      const result = await service.getMapflowById(COMPANY, FLOW_ID);
      expect(result).toEqual(FLOW_STUB);
    });

    it('lanza NotFoundException si el flow no existe', async () => {
      flowModel._findOneSpy.mockReturnValue(leanQuery(null));
      await expect(
        service.getMapflowById(COMPANY, 'no-existe'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateMapflow ─────────────────────────────────────────────────────────

  describe('updateMapflow', () => {
    it('actualiza los campos UI del flow', async () => {
      const dto = { name: 'Nuevo nombre', map: [] };
      await service.updateMapflow(COMPANY, FLOW_ID, dto as any);
      expect(ormMock.updateById).toHaveBeenCalledWith(
        FLOW_ID,
        expect.not.objectContaining({ map: expect.anything() }),
      );
    });

    it('llama a upsertRuntime si el map no está vacío', async () => {
      runtimeModel.findOne.mockReturnValue(sortLeanQuery(null));
      const dto = { name: 'X', map: [{ id: 'node-1' }] };
      const result = await service.updateMapflow(COMPANY, FLOW_ID, dto as any);
      expect(result.runtime).not.toBeNull();
    });

    it('no llama a upsertRuntime si map está vacío', async () => {
      const dto = { name: 'X', map: [] };
      const result = await service.updateMapflow(COMPANY, FLOW_ID, dto as any);
      expect(result.runtime).toBeNull();
    });
  });

  // ─── toggleActive ──────────────────────────────────────────────────────────

  describe('toggleActive', () => {
    it('lanza NotFoundException si el flow no existe', async () => {
      flowModel._findOneSpy.mockReturnValue(leanQuery(null));
      await expect(
        service.toggleActive(COMPANY, 'no-existe', false),
      ).rejects.toThrow(NotFoundException);
    });

    describe('active=false', () => {
      it('delega en cascade.onMapflowDeactivated', async () => {
        await service.toggleActive(COMPANY, FLOW_ID, false);
        expect(cascade.onMapflowDeactivated).toHaveBeenCalledWith(COMPANY, FLOW_ID);
      });

      it('NO llama a orm.updateById (cascade ya desactiva internamente)', async () => {
        await service.toggleActive(COMPANY, FLOW_ID, false);
        expect(ormMock.updateById).not.toHaveBeenCalled();
      });

      it('devuelve un mensaje de confirmación', async () => {
        const result = await service.toggleActive(COMPANY, FLOW_ID, false);
        expect(result).toHaveProperty('message');
      });
    });

    describe('active=true', () => {
      it('llama a orm.updateById con active=true', async () => {
        await service.toggleActive(COMPANY, FLOW_ID, true);
        expect(ormMock.updateById).toHaveBeenCalledWith(FLOW_ID, { active: true });
      });

      it('NO delega en cascade', async () => {
        await service.toggleActive(COMPANY, FLOW_ID, true);
        expect(cascade.onMapflowDeactivated).not.toHaveBeenCalled();
      });
    });
  });

  // ─── deleteMapflow ─────────────────────────────────────────────────────────

  describe('deleteMapflow', () => {
    it('lanza NotFoundException si el flow no existe (incluido deleted)', async () => {
      flowModel._findOneSpy.mockReturnValue(leanQuery(null));
      await expect(
        service.deleteMapflow(COMPANY, 'no-existe', false),
      ).rejects.toThrow(NotFoundException);
    });

    describe('hard=true', () => {
      it('llama a cascade.onMapflowRemoved con hard=true', async () => {
        await service.deleteMapflow(COMPANY, FLOW_ID, true);
        expect(cascade.onMapflowRemoved).toHaveBeenCalledWith(COMPANY, FLOW_ID, true);
      });

      it('elimina todos los runtimes del flow', async () => {
        await service.deleteMapflow(COMPANY, FLOW_ID, true);
        expect(runtimeModel.deleteMany).toHaveBeenCalledWith({ flowDefinitionId: FLOW_ID });
      });

      it('NO llama a orm.updateById en hard delete', async () => {
        await service.deleteMapflow(COMPANY, FLOW_ID, true);
        expect(ormMock.updateById).not.toHaveBeenCalled();
      });

      it('devuelve mensaje de confirmación', async () => {
        const result = await service.deleteMapflow(COMPANY, FLOW_ID, true);
        expect(result).toHaveProperty('message');
      });
    });

    describe('hard=false (soft delete)', () => {
      it('llama a cascade.onMapflowRemoved con hard=false', async () => {
        await service.deleteMapflow(COMPANY, FLOW_ID, false);
        expect(cascade.onMapflowRemoved).toHaveBeenCalledWith(COMPANY, FLOW_ID, false);
      });

      it('desactiva los runtimes del flow', async () => {
        await service.deleteMapflow(COMPANY, FLOW_ID, false);
        expect(runtimeModel.updateMany).toHaveBeenCalledWith(
          { flowDefinitionId: FLOW_ID },
          { active: false },
        );
      });

      it('marca el flow como deleted=true y active=false', async () => {
        await service.deleteMapflow(COMPANY, FLOW_ID, false);
        expect(ormMock.updateById).toHaveBeenCalledWith(
          FLOW_ID,
          { deleted: true, active: false },
        );
      });

      it('respeta el orden: cascade → deactivateRuntimes → updateById', async () => {
        const callOrder: string[] = [];
        cascade.onMapflowRemoved.mockImplementation(async () => { callOrder.push('cascade'); });
        runtimeModel.updateMany.mockImplementation(async () => { callOrder.push('runtimes'); return {}; });
        ormMock.updateById.mockImplementation(async () => { callOrder.push('updateById'); return FLOW_STUB; });

        await service.deleteMapflow(COMPANY, FLOW_ID, false);

        expect(callOrder).toEqual(['cascade', 'runtimes', 'updateById']);
      });
    });
  });

  // ─── getActiveRuntime ──────────────────────────────────────────────────────

  describe('getActiveRuntime', () => {
    it('devuelve el runtime activo más reciente', async () => {
      const result = await service.getActiveRuntime(COMPANY, FLOW_ID);
      expect(result).toEqual(RUNTIME_STUB);
    });

    it('lanza NotFoundException si no hay runtime activo', async () => {
      runtimeModel.findOne.mockReturnValue(sortLeanQuery(null));
      await expect(
        service.getActiveRuntime(COMPANY, FLOW_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getRuntimesByFlow ─────────────────────────────────────────────────────

  describe('getRuntimesByFlow', () => {
    it('devuelve todos los runtimes del flow ordenados por version desc', async () => {
      const result = await service.getRuntimesByFlow(COMPANY, FLOW_ID);
      expect(result).toEqual([RUNTIME_STUB]);
      expect(runtimeModel.find).toHaveBeenCalledWith({
        flowDefinitionId: FLOW_ID,
        company_id: COMPANY,
      });
    });
  });
});