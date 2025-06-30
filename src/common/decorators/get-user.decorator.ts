import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client'; // Importa el tipo User de Prisma

// Define un tipo para el usuario con la relación 'role' incluida
// Esto asume que tus consultas de Prisma en el AuthService/UserService incluyen { include: { role: true } }
export type UserWithRole = User & { role: { name: string } }; // Ajusta el tipo de 'role' según tu schema.prisma

export const GetUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): UserWithRole => {
    const request = ctx.switchToHttp().getRequest();
    // Asume que JwtGuard adjunta el usuario a request.user
    return request.user as UserWithRole;
  },
);
