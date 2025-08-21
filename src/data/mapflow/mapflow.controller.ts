import { Body, Controller, Param, Post } from '@nestjs/common';
import { MapflowService } from './mapflow.service';

@Controller('mapflows')
export class MapflowController {
  constructor(private readonly mapflowService: MapflowService) {}   

@Post(':companyId/:schemaId')
  async create(
    @Param('companyId') companyId: string,
    @Body() dto: any, 
  ) {
     console.log(dto);
     return 'ok';   
  }


}
