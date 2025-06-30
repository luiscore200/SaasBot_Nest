import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtService } from './jwt/jwt.service'; // Importar el servicio JwtService generado
import { JwtGuard } from './jwt/jwt.guard'; // Importar el guard JwtGuard generado
import { PrismaModule } from '../prisma/prisma.module'; // Asumiendo que PrismaModule está en esta ruta
import { AuthController } from './auth.controller'; // Importar el controlador

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'yourSecretKey', // Deberías usar una variable de entorno
      signOptions: { expiresIn: '60m' }, // Tiempo de expiración del token
    }),
  ],
  controllers: [AuthController], // Añadir el controlador aquí
  providers: [AuthService, JwtService, JwtGuard],
  exports: [AuthService, JwtService, JwtGuard],
})
export class AuthModule {}
