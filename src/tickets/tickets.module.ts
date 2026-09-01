import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { TicketsController } from './tickets.controller';
import { TicketsGateway } from './tickets.gateway';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    PrismaModule,
    // Mismo secreto que AuthModule (JWT_SECRET) para que el gateway pueda
    // verificar el mismo token que emite POST /auth/login.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [TicketsController],
  providers: [TicketsGateway, TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
