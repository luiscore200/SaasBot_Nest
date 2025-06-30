import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService as NestJwtService } from '@nestjs/jwt'; // Importar el servicio JWT de Nest
import { PrismaService } from '../../prisma/prisma.service'; // Ajusta la ruta según sea necesario
import { addHours } from 'date-fns'; // Necesitarás instalar date-fns

@Injectable()
export class JwtService {
  constructor(
    private prisma: PrismaService,
    private nestJwtService: NestJwtService, // Inyectar el servicio JWT de Nest
  ) {}

  // Método para verificar la firma del token y obtener el payload
  async verifyAccessToken(token: string): Promise<any> {
    try {
      // Usa el servicio de Nest para verificar el token.
      // Esto valida la firma y la expiración.
      const payload = await this.nestJwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'yourSecretKey', // Usar la misma clave secreta
      });
      return payload; // Retorna el payload si es válido
    } catch (error) {
      // Si la verificación falla (ej. token inválido o expirado), lanza una excepción
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  // Los métodos saveToken, validateToken (basado en DB) y removeToken
  // no son necesarios para la validación del access token JWT por firma.
  // Los mantengo por si tienen otro propósito en tu aplicación (ej. refresh tokens),
  // pero no se usarán en el JwtGuard para validar el access token.

  async saveToken(userId: number, token: string): Promise<void> {
    // Opcional: Eliminar tokens antiguos para este usuario
    await this.prisma.token.deleteMany({
      where: {
        userId: userId,
        // Puedes añadir lógica para no eliminar tokens que aún no expiran si quieres permitir múltiples sesiones
      },
    });

    // Guardar el nuevo token con una fecha de expiración (ej. 1 hora)
    const expiresAt = addHours(new Date(), 1); // Usando date-fns para calcular la expiración

    await this.prisma.token.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });
  }

  // Este método validateToken basado en DB no se usará para validar el access token JWT por firma
  async validateToken(token: string): Promise<boolean> {
      // Verifica si el token existe en la DB y no ha expirado
      const tokenRecord = await this.prisma.token.findUnique({
          where: { token },
          include: { user: true } // Opcional: incluir el usuario si lo necesitas
      });

      if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
          return false; // Token no encontrado o expirado
      }

      // Aquí podrías añadir más validaciones si es necesario
      return true; // Token válido
  }

  async removeToken(token: string): Promise<void> {
      // Elimina un token de la DB
      await this.prisma.token.delete({
          where: { token }
      });
  }
}
