import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CloudinaryService } from 'src/common/cloudinary/cloudinary.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { VEHICLE_SAFEGUARD_INCLUDE } from '../constants/vehicle-safeguard-query.const';
import { SignVehicleSafeguardDto } from '../dto/sign-vehicle-safeguard.dto';
import { VehicleSafeguardRecordsService } from './vehicle-safeguard-records.service';

/** Signing a vehicle safeguard and its scanned signed document (Cloudinary). */
@Injectable()
export class VehicleSafeguardSignatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly records: VehicleSafeguardRecordsService,
  ) {}

  async sign(
    id: string,
    dto: SignVehicleSafeguardDto,
    user: BranchScopedUser & { id: string },
  ) {
    const safeguard = await this.records.findOne(id, user);

    if (safeguard.supersededAt) {
      throw new BadRequestException(
        'No se puede firmar una versión histórica del resguardo',
      );
    }

    try {
      return await this.prisma.vehicleSafeguard.update({
        where: { id },
        data: {
          signedAt: new Date(),
          signedByUserId: user.id,
          signedDocumentPublicId: dto.signedDocumentPublicId ?? null,
        },
        include: VEHICLE_SAFEGUARD_INCLUDE,
      });
    } catch (error) {
      handleDatabaseErrors(error, 'VehicleSafeguard');
    }
  }

  async getSignedDocumentUrl(id: string, user: BranchScopedUser) {
    const safeguard = await this.records.findOne(id, user);

    if (!safeguard.signedDocumentPublicId) {
      throw new NotFoundException(
        'Este resguardo no tiene un documento firmado adjunto',
      );
    }

    return this.cloudinaryService.getSignedDownloadUrl(
      safeguard.signedDocumentPublicId,
    );
  }

  async createUploadSignature(id: string, user: BranchScopedUser) {
    const safeguard = await this.records.findOne(id, user);

    if (safeguard.supersededAt) {
      throw new BadRequestException(
        'No se puede adjuntar un documento a una versión histórica del resguardo',
      );
    }

    const publicId = `safeguards/vehicle-${safeguard.id}-${Date.now()}`;
    return this.cloudinaryService.generateSignedUploadParams(publicId);
  }
}
