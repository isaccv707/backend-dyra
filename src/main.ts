import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { PrismaClientExceptionFilter } from './common/filters/prisma-client-exception.filter';
import { parseCorsOrigins } from './common/utils/cors.util';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Application } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const httpAdapterInstance = app.getHttpAdapter().getInstance() as Application;
  httpAdapterInstance.set('query parser', 'extended');

  const config = new DocumentBuilder()
    .setTitle('Mi API en NestJS')
    .setDescription(
      'Documentación oficial de los endpoints de mi aplicación backend',
    )
    .setVersion('1.0')
    .addTag('users')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document);

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new PrismaClientExceptionFilter(httpAdapter));

  const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);

  app.setGlobalPrefix('api');
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
