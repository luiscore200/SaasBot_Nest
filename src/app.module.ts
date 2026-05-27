import { Module, ValidationPipe } from '@nestjs/common';

import { APP_PIPE, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';

import { ConfigModule, ConfigService } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModelsModule } from './mongoose/mongoose.module';
import { HttpExceptionFilter } from './common/filters/exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { AuthService } from './auth/auth.service';
import { RoleModule } from './role/role.module';
import { JwtService } from './auth/jwt/jwt.service';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';

import { CommonModule } from './common/common.module';
import { DataModule } from './data/data.module';
import { MongooseModule } from '@nestjs/mongoose';

import { GroqModule } from './groq/groq.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { IndexingModule } from './indexing/indexing.module';
import { QdrantModule } from './qdrant/qdrant.module';
import { EngineModule } from './engine/engine.module';
import { OllamaModule } from './ollama/ollama.module';



@Module({
  imports: [
    // Configuración de variables de entorno
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    PrismaModule,

    RoleModule,

    AuthModule,

    UserModule,

    CommonModule,

    DataModule,

     MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri:  `${config.get<string>('MONGODB_API')}${config.get<string>('MONGO_PERMISSIONS') }`|| 'mongodb://localhost:27017/mydb',
      }),
    }),

    

     GroqModule,

    

     EmbeddingModule,

    

     IndexingModule,

    

     QdrantModule,

    

     EngineModule,

    

     OllamaModule,

    

     

  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Validación global
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
   
  ],
})
export class AppModule {}
