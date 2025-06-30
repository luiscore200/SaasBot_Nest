import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaModule } from '../prisma/prisma.module'; // Importar PrismaModule
import { AuthModule } from '../auth/auth.module'; // Importar AuthModule
import { RoleModule } from '../role/role.module'; // Importar RoleModule
import { CommonModule } from '../common/common.module'; // Importar CommonModule

@Module({
  imports: [PrismaModule, AuthModule, RoleModule, CommonModule], // Añadir PrismaModule, AuthModule, RoleModule y CommonModule a los imports
  providers: [UserService],
  controllers: [UserController]
})
export class UserModule {}
