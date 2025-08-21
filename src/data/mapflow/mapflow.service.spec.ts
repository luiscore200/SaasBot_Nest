import { Test, TestingModule } from '@nestjs/testing';
import { MapflowService } from './mapflow.service';

describe('MapflowService', () => {
  let service: MapflowService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MapflowService],
    }).compile();

    service = module.get<MapflowService>(MapflowService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
