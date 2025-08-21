import { Test, TestingModule } from '@nestjs/testing';
import { MapflowController } from './mapflow.controller';

describe('MapflowController', () => {
  let controller: MapflowController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MapflowController],
    }).compile();

    controller = module.get<MapflowController>(MapflowController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
