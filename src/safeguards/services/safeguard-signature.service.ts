import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { CloudinaryService } from 'src/common/cloudinary/cloudinary.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { SAFEGUARD_INCLUDE } from '../constants/safeguard-query.const';
import { SignSafeguardDto } from '../dto/sign-safeguard.dto';
import { SafeguardRecordsService } from './safeguard-records.service';

/** Signing a safeguard and its scanned signed document (Cloudinary). */
@Injectable()
export class SafeguardSignatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly records: SafeguardRecordsService,
  ) {}

  async sign(
    id: string,
    dto: SignSafeguardDto,
    user: BranchScopedUser & { id: string },
  ) {
    const safeguard = await this.records.findOne(id, user);

    if (safeguard.supersededAt) {
      throw new BadRequestException(
        'No se puede firmar una versión histórica del resguardo',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const signed = await tx.safeguard.update({
          where: { id },
          data: {
            signedAt: new Date(),
            signedByUserId: user.id,
            signedDocumentPublicId: dto.signedDocumentPublicId ?? null,
          },
          include: SAFEGUARD_INCLUDE,
        });

        await tx.employee.update({
          where: { id: safeguard.employeeId },
          data: { hasSignedResponsibility: true },
        });

        return signed;
      });
    } catch (error) {
      handleDatabaseErrors(error, 'Safeguard');
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

    const publicId = `safeguards/device-${safeguard.id}-${Date.now()}`;
    return this.cloudinaryService.generateSignedUploadParams(publicId);
  }
}
