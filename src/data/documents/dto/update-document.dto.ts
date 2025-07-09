import { PartialType } from '@nestjs/mapped-types';
import { CreateDocumentDto, SingleDocumentDto } from './create-document.dto';

export class UpdateDocumentDto extends PartialType(SingleDocumentDto) {}
