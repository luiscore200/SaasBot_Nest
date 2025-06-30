import { PartialType } from '@nestjs/mapped-types'; // O '@nestjs/swagger' si lo usas
import { CreateUserDto } from './create-user.dto';
import { IsOptional, IsEnum, IsString, MinLength, IsEmail } from 'class-validator';
import { RoleName } from '@prisma/client';

// Usando PartialType de @nestjs/mapped-types para hacer todos los campos opcionales
export class UpdateUserDto extends PartialType(CreateUserDto) {
  // Si necesitas sobrescribir o añadir validaciones específicas para la actualización:
  @IsOptional()
  @IsEmail()
  email?: string; // Hacer email opcional si se permite no enviarlo en la actualización

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string; // Hacer password opcional

  @IsOptional()
  @IsString()
  name?: string; // Hacer name opcional

  @IsOptional()
  @IsEnum(RoleName)
  roleName?: RoleName; // Permitir actualizar el rol
}

/*
// Alternativa sin PartialType, definiendo cada campo opcionalmente:
export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(RoleName)
  roleName?: RoleName;
}
*/
