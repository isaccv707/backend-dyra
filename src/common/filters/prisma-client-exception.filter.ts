import { ArgumentsHost, Catch, ConflictException, HttpStatus, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaClientExceptionFilter extends BaseExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    switch (exception.code) {
      case 'P2002': {
        const status = HttpStatus.CONFLICT;
        const message = `Unique constraint failed on the fields: ${exception.meta?.target}`;
        response.status(status).json({
          statusCode: status,
          message: message,
          error: 'Conflict',
        });
        break;
      }
      case 'P2025': {
        const status = HttpStatus.NOT_FOUND;
        const message = (exception.meta?.cause as string) || 'Record not found';
        response.status(status).json({
          statusCode: status,
          message: message,
          error: 'Not Found',
        });
        break;
      }
      case 'P2003': {
        const status = HttpStatus.BAD_REQUEST;
        const message = 'Foreign key constraint failed on the field';
        response.status(status).json({
          statusCode: status,
          message: message,
          error: 'Bad Request',
        });
        break;
      }
      default:
        // default 500 error code
        super.catch(exception, host);
        break;
    }
  }
}
