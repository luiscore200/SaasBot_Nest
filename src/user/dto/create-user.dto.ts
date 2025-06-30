import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';
import { RoleName } from '@prisma/client'; // Importar el enum de Prisma

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6) // Ejemplo: mínimo 6 caracteres para la contraseña
  password: string;

  @IsString()
  name: string;

  @IsOptional() // Hacer el rol opcional en la creación si no siempre se asigna aquí
  @IsEnum(RoleName)
  roleName?: RoleName; // Nombre del rol a asignar (ej: 'USER', 'ADMIN')
}
