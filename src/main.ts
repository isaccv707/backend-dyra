import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { PrismaClientExceptionFilter } from './common/filters/prisma-client-exception.filter';
import { parseCorsOrigins } from './common/utils/cors.util';
import { SwaggerModule } from '@nestjs/swagger';
import { createOpenApiDocument } from './swagger';
import type { Application } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const httpAdapterInstance = app.getHttpAdapter().getInstance() as Application;
  httpAdapterInstance.set('query parser', 'extended');

  app.setGlobalPrefix('api');

  SwaggerModule.setup('api', app, createOpenApiDocument(app));

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new PrismaClientExceptionFilter(httpAdapter));

  const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
