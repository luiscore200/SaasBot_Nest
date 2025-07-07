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
    let details: string | undefined = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const res = exceptionResponse as Record<string, any>;

        if (
          exception instanceof BadRequestException &&
          Array.isArray(res.message)
        ) {
          // ⚡ Solo tomamos el primer mensaje
          const first = res.message[0];
          message = typeof first === 'string' ? first : 'Validation failed';
          error = 'VALIDATION_ERROR';
        } else {
          message = res.message || exception.message;
          error = res.error || exception.name;

          if (res.details) {
            details = res.details;
          }
        }
      } else {
        message = exceptionResponse as string;
      }
    }

    const errorResponse = {
      success: false,
      message,
      error,
      ...(details && { details }),
      timestamp: new Date().toISOString(),
      path: request.url,
      statusCode: status,
    };

    response.status(status).json(errorResponse);
  }
}
