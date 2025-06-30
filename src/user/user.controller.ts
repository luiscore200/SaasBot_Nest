import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseIntPipe, ForbiddenException } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtGuard } from '../auth/jwt/jwt.guard'; // Asegúrate de la ruta correcta
import { RoleGuard } from '../role/role.guard'; // Asegúrate de la ruta correcta
import { Roles } from '../common/decorators/roles.decorator'; // Asegúrate de la ruta correcta
import { RoleName } from '@prisma/client'; // Asegúrate de la ruta correcta
// Importar el tipo UserWithRole desde el decorador GetUser
import { GetUser, UserWithRole } from '../common/decorators/get-user.decorator'; // Asegúrate de la ruta correcta
import { ResponseManager } from '../common/utils/response.manager'; // Importar ResponseManager

@Controller('user')
@UseGuards(JwtGuard,RoleGuard) // Aplicar guards a nivel de controlador
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @Roles(RoleName.ADMIN) // Solo ADMIN puede crear usuarios
  async create(@Body() createUserDto: CreateUserDto) {
    const user = await this.userService.create(createUserDto);
    return ResponseManager.created(user, 'Usuario creado exitosamente');
  }

  @Get()
  @Roles(RoleName.USER,RoleName.ADMIN) // Solo ADMIN puede listar todos los usuarios
  async findAll() {
    const users = await this.userService.findAll();
    return ResponseManager.success(users, 'Usuarios obtenidos exitosamente');
  }

  @Get(':id')
  @Roles(RoleName.ADMIN, RoleName.USER) // ADMIN o USER pueden ver un usuario
  async findOne(@Param('id', ParseIntPipe) id: number, @GetUser() user: UserWithRole) { // Usar UserWithRole
    // Lógica adicional: permitir que un usuario vea su propio perfil
    if (user.role.name !== RoleName.ADMIN && user.id !== id) {
       // Lanzar ForbiddenException si no es ADMIN y no es su propio ID
       throw new ForbiddenException('You can only view your own profile');
    }
    const foundUser = await this.userService.findOne(id);
    return ResponseManager.success(foundUser, 'Usuario obtenido exitosamente');
  }

  @Patch(':id')
  @Roles(RoleName.ADMIN, RoleName.USER) // ADMIN o USER pueden actualizar un usuario
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateUserDto: UpdateUserDto, @GetUser() user: UserWithRole) { // Usar UserWithRole
     // Lógica adicional: permitir que un usuario actualice solo su propio perfil
     if (user.role.name !== RoleName.ADMIN && user.id !== id) {
        throw new ForbiddenException('You can only update your own profile');
     }
    const updatedUser = await this.userService.update(id, updateUserDto);
    return ResponseManager.updated(updatedUser, 'Usuario actualizado exitosamente');
  }

  @Delete(':id')
  @Roles(RoleName.ADMIN,RoleName.USER) // Solo ADMIN puede eliminar usuarios
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.userService.remove(id);
    return ResponseManager.deleted('Usuario eliminado exitosamente');
  }
}
