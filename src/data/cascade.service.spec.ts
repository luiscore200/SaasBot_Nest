import { Test, TestingModule } from '@nestjs/testing';
import { CascadeService } from './cascade.service';

describe('CascadeService', () => {
  let service: CascadeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CascadeService],
    }).compile();

    service = module.get<CascadeService>(CascadeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
