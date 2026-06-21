import { Test, TestingModule } from '@nestjs/testing';
import { WidgetCorsService } from './widgetCors.service';

describe('WidgetCorsService', () => {
  let service: WidgetCorsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WidgetCorsService],
    }).compile();

    service = module.get<WidgetCorsService>(WidgetCorsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
