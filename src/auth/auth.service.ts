import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { JwtService as AppJwtService } from './jwt/jwt.service'; // Servicio para interactuar con la tabla Token

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: NestJwtService, // JwtService de NestJS para generar/verificar tokens
    private appJwtService: AppJwtService, // Nuestro servicio para gestionar tokens en DB
  ) {}

  async register(registerDto: RegisterAuthDto): Promise<{ token: string,user:any }> {
    const { email, password, name, roleId } = registerDto;

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new BadRequestException('El email ya está registrado.');
    }

    // Asignar un rol por defecto si no se especifica
    const finalRoleId = roleId ?? (await this.getDefaultRoleId());
    if (!finalRoleId) {
        throw new BadRequestException('No se pudo determinar un rol para el usuario.');
    }

    const hashedPassword = await bcrypt.hash(password, 10); // 10 es el saltRounds

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        roleId: finalRoleId,
      },
      include: {
        role: true, // Incluir la relación Role para obtener el nombre
      },
    });

    const payload = { email: user.email, sub: user.id, roleName: user.role.name };
    const token = this.jwtService.sign(payload);

    // Guardar el token en la base de datos
    await this.appJwtService.saveToken(user.id, token);

    return { token,user:{...payload,name:user.name,role:user.role.name}};
  }

  async login(loginDto: LoginAuthDto): Promise<{  token: string,user:any  }> {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        role: true, // Incluir la relación Role para obtener el nombre
      },
    });
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const payload = { email: user.email, sub: user.id, roleName: user.role.name };
    const token = this.jwtService.sign(payload);

    // Guardar el token en la base de datos (o actualizar si ya existe uno activo)
    await this.appJwtService.saveToken(user.id, token);

    return { token,user:{...payload,name:user.name,role:user.role.name}};
  }

  async validateUser(payload: any): Promise<any> {
    // Este método es usado por la estrategia JWT para validar el payload
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException();
    }
    // Puedes retornar el usuario o un subconjunto de sus datos
    return user;
  }

 
  private async getDefaultRoleId(): Promise<number | null> {
    // Implementa la lógica para obtener el ID del rol por defecto, por ejemplo, buscando un rol con nombre 'user'
    const defaultRole = await this.prisma.role.findUnique({ where: { name: 'USER' } }); // Corregido a 'USER'
    return defaultRole?.id ?? null;
}
}
