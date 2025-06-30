import { Module } from '@nestjs/common';
import { RoleService } from './role.service';
import { CommonModule } from '../common/common.module'; // Importar CommonModule

@Module({
  imports: [CommonModule], // Importar CommonModule
  providers: [RoleService]
})
export class RoleModule {}
