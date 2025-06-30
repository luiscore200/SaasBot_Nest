import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'; // Asegúrate de la ruta correcta
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt'; // Para hashear contraseñas

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    // Hashear la contraseña antes de guardar
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10); // 10 es el saltRounds

    const data: any = { // Usamos any temporalmente para construir el objeto de datos
      email: createUserDto.email,
      password: hashedPassword,
      name: createUserDto.name,
    };

    // Si se proporciona roleName en el DTO, conectar el rol
    if (createUserDto.roleName) {
      data.role = {
        connect: { name: createUserDto.roleName },
      };
    } else {
      // Opcional: Asignar un rol por defecto si no se proporciona
      // data.role = { connect: { name: 'USER' } };
    }

    return this.prisma.user.create({
      data,
      include: {
        role: true, // Incluir la relación de rol en la respuesta
      },
    });
  }

  findAll() {
    return this.prisma.user.findMany({
      include: {
        role: true,
      },
    });
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const dataToUpdate: any = {}; // Usamos any temporalmente

    if (updateUserDto.email !== undefined) dataToUpdate.email = updateUserDto.email;
    if (updateUserDto.name !== undefined) dataToUpdate.name = updateUserDto.name;

    // Opcional: Hashear la nueva contraseña si se proporciona
    if (updateUserDto.password !== undefined) {
      dataToUpdate.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    // Si se proporciona roleName en el DTO, conectar el rol
    if (updateUserDto.roleName !== undefined) {
       dataToUpdate.role = {
         connect: { name: updateUserDto.roleName },
       };
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data: dataToUpdate,
        include: {
          role: true,
        },
      });
    } catch (error) {
      // Manejar caso donde el usuario no existe
      if (error.code === 'P2025') { // Código de error de Prisma para registro no encontrado
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      throw error; // Re-lanzar otros errores
    }
  }

  async remove(id: number) {
    try {
      return await this.prisma.user.delete({
        where: { id },
        include: {
          role: true,
        },
      });
    } catch (error) {
      // Manejar caso donde el usuario no existe
      if (error.code === 'P2025') { // Código de error de Prisma para registro no encontrado
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      throw error; // Re-lanzar otros errores
    }
  }

  // Método adicional para encontrar por email, útil para autenticación
  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        role: true,
      },
    });
  }
}
