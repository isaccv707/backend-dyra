import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { SafeguardsService } from './safeguards.service';
import { SafeguardsController } from './safeguards.controller';
import { SafeguardPdfRenderer } from './pdf/safeguard-pdf.renderer';

@Module({
  imports: [PrismaModule],
  controllers: [SafeguardsController],
  providers: [SafeguardsService, SafeguardPdfRenderer],
  exports: [SafeguardsService],
})
export class SafeguardsModule {}
