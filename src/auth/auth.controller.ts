import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { ResponseManager } from '../common/utils/response.manager'; // Importar ResponseManager
import { ApiResponse } from '../common/interfaces/response.interface'; // Importar ApiResponse

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED) // Código 201 para creación exitosa
  async register(@Body() registerDto: RegisterAuthDto): Promise<ApiResponse<any>> {
    const result = await this.authService.register(registerDto);
    return ResponseManager.created(result, 'User registered successfully');
  }

  @Post('login')
  @HttpCode(HttpStatus.OK) // Código 200 para éxito
  async login(@Body() loginDto: LoginAuthDto): Promise<ApiResponse<any>> {
    const result = await this.authService.login(loginDto);
    return ResponseManager.success(result, 'User logged in successfully');
  }
}
