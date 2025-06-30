import { Test, TestingModule } from '@nestjs/testing';
import { PercistenceService } from './percistence.service';

describe('PercistenceService', () => {
  let service: PercistenceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PercistenceService],
    }).compile();

    service = module.get<PercistenceService>(PercistenceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
