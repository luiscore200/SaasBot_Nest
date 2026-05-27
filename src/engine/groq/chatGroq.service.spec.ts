import { Test, TestingModule } from '@nestjs/testing';
import { ChatGroqService } from './chatGroq.service';

describe('ChatGroqService', () => {
  let service: ChatGroqService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChatGroqService],
    }).compile();

    service = module.get<ChatGroqService>(ChatGroqService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
