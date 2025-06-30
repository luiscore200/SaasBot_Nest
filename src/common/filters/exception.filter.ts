import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    BadRequestException,
  } from '@nestjs/common';
  import { Request, Response } from 'express';

  
  @Catch()
  export class HttpExceptionFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<Response>();
      const request = ctx.getRequest<Request>();
  
      let status = HttpStatus.INTERNAL_SERVER_ERROR;
      let message = 'Internal server error';
      let error = 'INTERNAL_SERVER_ERROR';
      let validationErrors: string[] = [];
  
      if (exception instanceof HttpException) {
        status = exception.getStatus();
        const exceptionResponse = exception.getResponse();
        
        if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
          const responseObj = exceptionResponse as any;
          
          // Manejar errores de validación específicamente
          if (exception instanceof BadRequestException && Array.isArray(responseObj.message)) {
            message = 'Validation failed';
            error = 'VALIDATION_ERROR';
            validationErrors = responseObj.message;
          } else {
            message = responseObj.message || exception.message;
            error = responseObj.error || exception.name;
            
            if (Array.isArray(responseObj.message)) {
              validationErrors = responseObj.message;
              message = 'Validation failed';
              error = 'VALIDATION_ERROR';
            }
          }
        } else {
          message = exceptionResponse as string;
        }
      }
  
      // Crear respuesta de error mejorada
      const errorResponse = {
        success: false,
        message,
        error,
        ...(validationErrors.length > 0 && { validationErrors }),
        timestamp: new Date().toISOString(),
        path: request.url,
        statusCode: status,
      };
  
      response.status(status).json(errorResponse);
    }
  }