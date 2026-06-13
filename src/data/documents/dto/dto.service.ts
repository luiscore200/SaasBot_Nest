import { BadRequestException, Injectable } from '@nestjs/common';
import { SchemaModel } from 'src/mongoose/schemas.schema';

@Injectable()
export class DtoService {
  validateDataAgainstSchema(
    data: Record<string, any> | Record<string, any>[],
    schema: SchemaModel,
    options: { isArray?: boolean; strict?: boolean; partial?: boolean } = {},
  ) {
    const { isArray = false, strict = true, partial = false } = options;

    if (isArray) {
      if (!Array.isArray(data)) {
        throw new BadRequestException(`Expected an array of documents.`);
      }
      for (const item of data) {
        this.validateSingle(item, schema, strict, partial);
      }
    } else {
      this.validateSingle(data as Record<string, any>, schema, strict, partial);
    }
  }

  private validateSingle(
    data: Record<string, any>,
    schema: SchemaModel,
    strict: boolean,
    partial: boolean,
  ) {
    for (const field of schema.fields) {
      // ── Campos auto: nunca son requeridos desde el usuario ─────────────
      if (field.auto) continue;

      const value = data[field.name];

      if (!partial && field.required && value === undefined) {
        throw new BadRequestException(`Field "${field.name}" is required.`);
      }

      if (value !== undefined) {
        switch (field.type) {
          case 'string':
            if (typeof value !== 'string')
              throw new BadRequestException(`Field "${field.name}" must be string.`);
            break;
          case 'number':
            if (typeof value !== 'number')
              throw new BadRequestException(`Field "${field.name}" must be number.`);
            break;
          case 'boolean':
            if (typeof value !== 'boolean')
              throw new BadRequestException(`Field "${field.name}" must be boolean.`);
            break;
          case 'json':
            if (typeof value !== 'object' || Array.isArray(value))
              throw new BadRequestException(`Field "${field.name}" must be object.`);
            break;
          case 'date':
            if (isNaN(Date.parse(value)))
              throw new BadRequestException(`Field "${field.name}" must be valid date.`);
            break;
        }
      }
    }

    if (strict) {
      // ── Solo campos sin auto cuentan como "permitidos desde el usuario" ─
      const allowed = schema.fields
        .filter(f => !f.auto)
        .map(f => f.name);

      const extra = Object.keys(data).filter(k => !allowed.includes(k));
      if (extra.length > 0) {
        throw new BadRequestException(`Unknown fields: ${extra.join(', ')}`);
      }
    }
  }
}