import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Application } from 'express';
import { PrismaClientExceptionFilter } from './common/filters/prisma-client-exception.filter';
import { registerBodyParsers } from './common/middleware/body-parsers';
import { parseCorsOrigins } from './common/utils/cors.util';

/**
 * HTTP setup shared by main.ts and the e2e tests, so tests run the same
 * prefix, body limits, validation and error mapping as production. The app
 * must be created with `bodyParser: false`.
 */
export function configureApp(app: INestApplication) {
  const httpAdapterInstance = app.getHttpAdapter().getInstance() as Application;
  httpAdapterInstance.set('query parser', 'extended');
  registerBodyParsers(httpAdapterInstance);

  app.setGlobalPrefix('api');

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new PrismaClientExceptionFilter(httpAdapter));

  app.enableCors({
    origin: parseCorsOrigins(process.env.CORS_ORIGINS),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}
