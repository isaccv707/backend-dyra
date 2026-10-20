import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { createOpenApiDocument } from '../swagger';

// Writes openapi.json at the repo root without a database: preview mode builds
// the module graph but never instantiates providers (no Prisma connection).
// Run through `yarn openapi:export`, which compiles first so the
// @nestjs/swagger CLI plugin can infer the DTO schemas.
async function exportOpenApi() {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });
  app.setGlobalPrefix('api');

  const document = createOpenApiDocument(app);
  const outputPath = resolve(__dirname, '../../../openapi.json');
  writeFileSync(outputPath, JSON.stringify(document, null, 2) + '\n');
  await app.close();

  console.log(`OpenAPI written to ${outputPath}`);
}

void exportOpenApi();
