import { Test, TestingModule } from '@nestjs/testing';
import { IndexingService } from './indexing.service';

describe('IndexingService', () => {
  let service: IndexingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IndexingService],
    }).compile();

    service = module.get<IndexingService>(IndexingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
