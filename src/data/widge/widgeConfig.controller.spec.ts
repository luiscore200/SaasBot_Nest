import { Test, TestingModule } from '@nestjs/testing';
import { WidgeConfigController } from './widgeConfig.controller';

describe('WidgeConfigController', () => {
  let controller: WidgeConfigController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WidgeConfigController],
    }).compile();

    controller = module.get<WidgeConfigController>(WidgeConfigController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
