import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule } from '@nestjs/swagger';
import { createOpenApiDocument } from './swagger';
import { configureApp } from './app.setup';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  configureApp(app);

  // Without REDIS_URL (one instance, local dev) Socket.IO keeps its in-memory adapter.
  if (process.env.REDIS_URL) {
    const redisIoAdapter = new RedisIoAdapter(app, process.env.REDIS_URL);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
  }

  SwaggerModule.setup('api', app, createOpenApiDocument(app));

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
