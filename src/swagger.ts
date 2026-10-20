import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

// Shared by main.ts (Swagger UI at /api) and scripts/export-openapi.ts (the
// openapi.json the frontends generate their types from). Call it after
// setGlobalPrefix('api') so the documented paths match the real ones.
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('DYRA API')
    .setDescription(
      'API de DYRA (Diagnóstico y Referencia Analítica): consumida por admin-dyra-web y dira-astro.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  return SwaggerModule.createDocument(app, config);
}
