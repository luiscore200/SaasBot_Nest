import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleName } from '@prisma/client'; // Importar el enum de Prisma
import { ROLES_KEY } from '../common/decorators/roles.decorator'; // Importar la clave del decorador
import { PercistenceService } from '../common/services/percistence/percistence.service'; // Importar PercistenceService

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private percistenceService: PercistenceService, // Inyectar PercistenceService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> { // Hacer canActivate asíncrono
    console.log('RoleGuard: canActivate executing'); // Log 1

    // Obtener los nombres de roles requeridos del decorador
    const requiredRoleNames = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    console.log('RoleGuard: Required role names:', requiredRoleNames); // Log 2

    // Si no se especifican roles requeridos, permitir el acceso
    if (!requiredRoleNames || requiredRoleNames.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    // Asumimos que el JwtGuard ya ha adjuntado el usuario al request en req.user
    // El payload del JWT debería incluir el rol del usuario.
    // Ajusta la siguiente línea según la estructura real de tu payload JWT.
    // Asumo que user.role es el nombre del rol (RoleName)
    const user = request.user;

    console.log('RoleGuard: User from request:', user); // Log 3

    // Verificar si el usuario existe en el request y tiene un roleId
    if (!user || user.roleId === undefined || user.roleId === null) {
      throw new UnauthorizedException('User or user role ID not found in request. Ensure JwtGuard is applied before RoleGuard and attaches user with roleId.');
    }

    const userRoleId: number = user.roleId;

    console.log('RoleGuard: User role ID:', userRoleId); // Log 4

    // Obtener el objeto Role del usuario por su ID usando PercistenceService
    const userRole2 = await this.percistenceService.getRoles(); // Usar getRoleById y await
    const userRole = userRole2.find(item => item.id===userRoleId)
    console.log(userRole);

    if (!userRole) {
        console.log(`RoleGuard: User role with ID '${userRoleId}' not found in available roles.`);
        // Si el rol del usuario no existe en la base de datos, denegar acceso por seguridad
        throw new UnauthorizedException(`Invalid user role ID: ${userRoleId}`);
    }

    const userRoleName: RoleName = userRole.name; // Obtener el nombre del rol del objeto Role

    console.log('RoleGuard: User role name:', userRoleName); // Log 5

    // Verificar si el nombre del rol del usuario coincide con alguno de los nombres de los roles requeridos
    const hasRequiredRole = requiredRoleNames.some(requiredName => userRoleName === requiredName);

    if (!hasRequiredRole) {
      console.log('RoleGuard: User does not have required role. Access denied.'); // Log 6
      throw new ForbiddenException('Insufficient role permissions'); // Lanzar ForbiddenException
    }

    console.log('RoleGuard: User has required role. Access granted.'); // Log 7
    return true; // Permitir acceso
  }
}
