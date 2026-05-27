import { Test, TestingModule } from '@nestjs/testing';
import { WidgeConfigService } from './widgeConfig.service';

describe('WidgeConfigService', () => {
  let service: WidgeConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WidgeConfigService],
    }).compile();

    service = module.get<WidgeConfigService>(WidgeConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
