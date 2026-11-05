import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { CloudinaryModule } from 'src/common/cloudinary/cloudinary.module';
import { PdfDrawingKit } from 'src/common/pdf/pdf-drawing.util';
import { VehicleSafeguardsService } from './vehicle-safeguards.service';
import { VehicleSafeguardsController } from './vehicle-safeguards.controller';
import { VehicleSafeguardPdfRenderer } from './pdf/vehicle-safeguard-pdf.renderer';
import { VehicleSafeguardGenerationService } from './services/vehicle-safeguard-generation.service';
import { VehicleSafeguardPdfService } from './services/vehicle-safeguard-pdf.service';
import { VehicleSafeguardRecordsService } from './services/vehicle-safeguard-records.service';
import { VehicleSafeguardSignatureService } from './services/vehicle-safeguard-signature.service';

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [VehicleSafeguardsController],
  providers: [
    VehicleSafeguardsService,
    VehicleSafeguardPdfRenderer,
    PdfDrawingKit,
    VehicleSafeguardGenerationService,
    VehicleSafeguardRecordsService,
    VehicleSafeguardSignatureService,
    VehicleSafeguardPdfService,
  ],
  exports: [VehicleSafeguardsService],
})
export class VehicleSafeguardsModule {}
