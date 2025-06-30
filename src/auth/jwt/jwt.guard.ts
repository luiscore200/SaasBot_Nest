import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from './jwt.service'; // Importar mi JwtService

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private jwtService: JwtService) {} // Inyectar mi JwtService

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Token not found');
    }

    try {
      // Usar mi JwtService para verificar el token y obtener el payload
      const payload = await this.jwtService.verifyAccessToken(token);

      // Adjuntar el payload al objeto request
      request['user'] = payload;

    } catch (error) {
      // Si la verificación falla (ej. token inválido o expirado), verifyAccessToken ya lanza UnauthorizedException
      // Si necesitas manejar otros errores aquí, puedes hacerlo.
      throw new UnauthorizedException('Invalid or expired token');
    }

    return true; // Permitir el acceso si el token es válido y el payload se adjuntó
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
