import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DocumentModel } from '../../mongoose/documents.schema';

@Injectable()
export class DocumentsService {
  constructor(@InjectModel('Document') private documentModel: Model<DocumentModel>) {}


}
