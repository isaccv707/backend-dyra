import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { PrismaClientExceptionFilter } from './common/filters/prisma-client-exception.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  const config = new DocumentBuilder()
    .setTitle('Mi API en NestJS')
    .setDescription(
      'Documentación oficial de los endpoints de mi aplicación backend',
    )
    .setVersion('1.0')
    .addTag('users') // Puedes añadir etiquetas para organizar tus rutas
    .addBearerAuth() // Opcional: Si usas autenticación JWT
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // '/api' será la ruta para acceder a la documentación
  SwaggerModule.setup('api', app, document);

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new PrismaClientExceptionFilter(httpAdapter));

  const rawOrigins = process.env.CORS_ORIGINS || '';

  const allowedOrigins = rawOrigins.split(',').map((origin) => origin.trim());

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
bootstrap();
