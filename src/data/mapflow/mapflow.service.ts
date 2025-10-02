import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PersistenceService } from 'src/common/services/percistence/persistence.service';
import {
  MapflowModel,
  MapflowModelSchema
} from '../../mongoose/mapflows.schema';
import { MongoOrmService } from 'src/mongoose/mongoose.service';
import { CreateMapflowDto } from './dto/create-mapflow.dto';
import { UpdateMapflowDto } from './dto/update-mapflow.dto';


@Injectable()
export class MapflowService {
  constructor(private readonly persistence: PersistenceService) {}

  async createMapflow(companyId: string, data: CreateMapflowDto) {
    const model = await this.persistence.getTenantModel<MapflowModel>(
      companyId,
      'Mapflow',
      MapflowModelSchema,
    );
    const orm = new MongoOrmService<MapflowModel>(model);

    return orm.create(data);
  }

  async getMapflowsByCompany(companyId: string, deleted?: boolean) {
    const model = await this.persistence.getTenantModel<MapflowModel>(
      companyId,
      'Mapflow',
      MapflowModelSchema,
    );
    const orm = new MongoOrmService<MapflowModel>(model);

    const query: any = { company_id: companyId };
    query.deleted = deleted !== undefined ? deleted : false;

    return orm.findAll(query);
  }

  async getMapflowById(companyId: string, id: string, deleted?: boolean) {
    const model = await this.persistence.getTenantModel<MapflowModel>(
      companyId,
      'Mapflow',
      MapflowModelSchema,
    );
    const orm = new MongoOrmService<MapflowModel>(model);

    const query: any = { _id: id };
    query.deleted = deleted !== undefined ? deleted : false;

    const mapflow = await orm.findOne(query);
    if (!mapflow) {
      throw new NotFoundException({
        message: `No se encontró un mapflow con ID "${id}".`,
      });
    }

    return mapflow;
  }

  async updateMapflow(companyId: string, id: string, data: UpdateMapflowDto) {
  const model = await this.persistence.getTenantModel<MapflowModel>(
    companyId,
    'Mapflow',
    MapflowModelSchema,
  );
  const orm = new MongoOrmService<MapflowModel>(model);

  const existing = await orm.findOne({ _id: id, deleted: false });
  if (!existing) {
    throw new NotFoundException({
      message: `No se encontró un mapflow con ID "${id}" o está eliminado.`,
    });
  }

  // 👇 reescribes el documento completo
  const updated = await orm.updateById(id, data);
  return updated;
}


  async deleteMapflow(companyId: string, id: string, hard?: boolean) {
    const model = await this.persistence.getTenantModel<MapflowModel>(
      companyId,
      'Mapflow',
      MapflowModelSchema,
    );
    const orm = new MongoOrmService<MapflowModel>(model);

    const existing = await orm.findOne({ _id: id });
    if (!existing) {
      throw new NotFoundException({
        message: `No se encontró un mapflow con ID "${id}".`,
      });
    }

    if (hard) {
      return orm.deleteById(id);
    } else {
      return orm.updateById(id, { deleted: true });
    }
  }
}
