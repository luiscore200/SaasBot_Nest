import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
  } from '@nestjs/common';
  import { Observable } from 'rxjs';
  import { map } from 'rxjs/operators';
  import { ResponseManager } from '../utils/response.manager';
  
  @Injectable()
  export class ResponseInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
      const request = context.switchToHttp().getRequest();
      const response = context.switchToHttp().getResponse();
      
      return next.handle().pipe(
        map((data) => {
          // Si la respuesta ya tiene el formato de ApiResponse, no la modificar
          if (data && typeof data === 'object' && 'success' in data) {
            return data;
          }
  
          // Determinar el mensaje basado en el método HTTP
          let message = 'Operation successful';
          const method = request.method;
          
          switch (method) {
            case 'POST':
              message = 'Resource created successfully';
              break;
            case 'PUT':
            case 'PATCH':
              message = 'Resource updated successfully';
              break;
            case 'DELETE':
              message = 'Resource deleted successfully';
              break;
            case 'GET':
              message = 'Data retrieved successfully';
              break;
          }
  
          return ResponseManager.success(
            data,
            message,
            response.statusCode,
            request.url,
          );
        }),
      );
    }
  }