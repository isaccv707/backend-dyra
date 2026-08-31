import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { CloudinaryModule } from 'src/common/cloudinary/cloudinary.module';
import { PdfDrawingKit } from 'src/common/pdf/pdf-drawing.util';
import { SafeguardsService } from './safeguards.service';
import { SafeguardsController } from './safeguards.controller';
import { SafeguardPdfRenderer } from './pdf/safeguard-pdf.renderer';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [SafeguardsController],
  providers: [SafeguardsService, SafeguardPdfRenderer, PdfDrawingKit],
  exports: [SafeguardsService],
})
export class SafeguardsModule {}
