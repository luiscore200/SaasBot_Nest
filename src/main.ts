import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { ValidationPipe } from '@nestjs/common';
import { WidgetCorsService } from './data/widge/widgetCors.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(new ValidationPipe());

  const widgetCors = app.get(WidgetCorsService);

  // Origins estáticos — la plataforma SaaS administrativa
  // Pueden ser varios si hay staging, preview, etc.
  const PLATFORM_ORIGINS = [
    process.env.BASE_URL,          // http://localhost:8080/ en dev, dominio real en prod
  ].filter(Boolean).map(o => o!.replace(/\/$/, '')); // normaliza trailing slash

  app.enableCors({
    origin: (origin, callback) => {
      // Sin origin → request server-to-server o mismo origen → permitir
      if (!origin) return callback(null, true);

      // Plataforma administrativa → siempre permitida
      const isPlatform = PLATFORM_ORIGINS.some(o => origin === o);
      if (isPlatform) return callback(null, true);

      // Dominios de widgets registrados → dinámico desde DB
      if (widgetCors.isAllowed(origin)) return callback(null, true);

      callback(new Error(`Origin "${origin}" no permitido por CORS`), false);
    },
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials:    true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();