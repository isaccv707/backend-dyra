import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { CloudinaryModule } from 'src/common/cloudinary/cloudinary.module';
import { PdfDrawingKit } from 'src/common/pdf/pdf-drawing.util';
import { VehicleSafeguardsService } from './vehicle-safeguards.service';
import { VehicleSafeguardsController } from './vehicle-safeguards.controller';
import { VehicleSafeguardPdfRenderer } from './pdf/vehicle-safeguard-pdf.renderer';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [VehicleSafeguardsController],
  providers: [VehicleSafeguardsService, VehicleSafeguardPdfRenderer, PdfDrawingKit],
  exports: [VehicleSafeguardsService],
})
export class VehicleSafeguardsModule {}
