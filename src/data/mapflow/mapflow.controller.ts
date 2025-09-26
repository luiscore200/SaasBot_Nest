import { Body, Controller, Param, Post } from '@nestjs/common';
import { MapflowService } from './mapflow.service';
import { CreateMapflowDto } from './dto/create-mapflow.dto';
import { CreateMapflowPayload } from './types';

@Controller('mapflows')
export class MapflowController {
  constructor(private readonly mapflowService: MapflowService) {}   

@Post(':companyId')
  async create(
    @Param('companyId') companyId: string,
    @Body() dto:CreateMapflowDto, 
  ) {
     const i:CreateMapflowPayload=dto;
      console.log(i);

     return 'ok';   
  }

}
