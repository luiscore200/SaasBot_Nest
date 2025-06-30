import { HttpStatus } from '@nestjs/common';
import { ApiResponse, PaginatedResponse } from '../interfaces/response.interface';

export class ResponseManager {
  static success<T>(
    data: T,
    message: string = 'Operation successful',
    statusCode: number = HttpStatus.OK,
    path?: string,
  ): ApiResponse<T> {
    return {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
      path: path || '',
      statusCode,
    };
  }

  static error(
    message: string,
    error?: string,
    statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR,
    path?: string,
  ): ApiResponse {
    return {
      success: false,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: path || '',
      statusCode,
    };
  }

  static created<T>(
    data: T,
    message: string = 'Resource created successfully',
    path?: string,
  ): ApiResponse<T> {
    return this.success(data, message, HttpStatus.CREATED, path);
  }

  static updated<T>(
    data: T,
    message: string = 'Resource updated successfully',
    path?: string,
  ): ApiResponse<T> {
    return this.success(data, message, HttpStatus.OK, path);
  }

  static deleted(
    message: string = 'Resource deleted successfully',
    path?: string,
  ): ApiResponse {
    return {
      success: true,
      message,
      timestamp: new Date().toISOString(),
      path: path || '',
      statusCode: HttpStatus.OK,
    };
  }

  static paginated<T>(
    items: T[],
    page: number,
    limit: number,
    total: number,
    message: string = 'Data retrieved successfully',
    path?: string,
  ): PaginatedResponse<T> {
    const totalPages = Math.ceil(total / limit);
    
    return {
      success: true,
      message,
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
      timestamp: new Date().toISOString(),
      path: path || '',
      statusCode: HttpStatus.OK,
    };
  }

  static notFound(
    message: string = 'Resource not found',
    path?: string,
  ): ApiResponse {
    return this.error(message, 'NOT_FOUND', HttpStatus.NOT_FOUND, path);
  }

  static badRequest(
    message: string = 'Bad request',
    error?: string,
    path?: string,
  ): ApiResponse {
    return this.error(message, error, HttpStatus.BAD_REQUEST, path);
  }

  static unauthorized(
    message: string = 'Unauthorized access',
    path?: string,
  ): ApiResponse {
    return this.error(message, 'UNAUTHORIZED', HttpStatus.UNAUTHORIZED, path);
  }

  static forbidden(
    message: string = 'Access forbidden',
    path?: string,
  ): ApiResponse {
    return this.error(message, 'FORBIDDEN', HttpStatus.FORBIDDEN, path);
  }

  static conflict(
    message: string = 'Resource conflict',
    error?: string,
    path?: string,
  ): ApiResponse {
    return this.error(message, error, HttpStatus.CONFLICT, path);
  }
}