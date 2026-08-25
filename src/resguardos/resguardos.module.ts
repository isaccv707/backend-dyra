import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { ResguardosService } from './resguardos.service';
import { ResguardosController } from './resguardos.controller';
import { ResguardoPdfRenderer } from './pdf/resguardo-pdf.renderer';

@Module({
  imports: [PrismaModule],
  controllers: [ResguardosController],
  providers: [ResguardosService, ResguardoPdfRenderer],
  exports: [ResguardosService],
})
export class ResguardosModule {}
