import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import {
  buildPaginatedQuery,
  paginatedResponse,
} from 'src/common/utils/paginate.util';
import {
  assertBranchAccess,
  BranchScopedUser,
  userBranchFilter,
} from 'src/common/utils/branch-access.util';
import { CreateStudyProviderDto } from './dto/create-study-provider.dto';
import { UpdateStudyProviderDto } from './dto/update-study-provider.dto';
import { FindStudyProvidersDto } from './dto/find-study-providers.dto';

const PROVIDER_ALLOWED_FIELDS = ['name', 'isActive', 'createdAt'];

const ENTITY_NAME = 'Maquilador';

const WITH_STUDY_COUNTS = {
  _count: { select: { studies: true } },
} as const;

/**
 * Maquiladores (laboratorios externos) por sucursal. Mismas reglas que los
 * catálogos de estudios: nombre único case-insensitive por sucursal y, si
 * algún estudio lo usa, no se borra: se desactiva.
 */
@Injectable()
export class StudyProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertNameAvailable(
    branchId: string,
    name: string,
    excludeId?: string,
  ) {
    const duplicate = await this.prisma.studyProvider.findFirst({
      where: {
        branchId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId && { NOT: { id: excludeId } }),
      },
    });
    if (duplicate) {
      throw new ConflictException(
        `Ya existe el maquilador "${duplicate.name}" en esta sucursal`,
      );
    }
  }

  async create(dto: CreateStudyProviderDto, user: BranchScopedUser) {
    assertBranchAccess(user, dto.branchId);

    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branchId },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundException(
        `Sucursal con el ID ${dto.branchId} no encontrada`,
      );
    }
    await this.assertNameAvailable(dto.branchId, dto.name);

    try {
      return await this.prisma.studyProvider.create({
        data: dto,
        include: WITH_STUDY_COUNTS,
      });
    } catch (error) {
      handleDatabaseErrors(error, ENTITY_NAME);
    }
  }

  async findAll(dto: FindStudyProvidersDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name'],
      defaultSort: { name: 'asc' },
      allowedFields: PROVIDER_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };

    const [data, total] = await Promise.all([
      this.prisma.studyProvider.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: WITH_STUDY_COUNTS,
      }),
      this.prisma.studyProvider.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string, user: BranchScopedUser) {
    const provider = await this.prisma.studyProvider.findUnique({
      where: { id },
      include: WITH_STUDY_COUNTS,
    });
    if (!provider) {
      throw new NotFoundException(`Maquilador con el ID ${id} no encontrado`);
    }
    assertBranchAccess(user, provider.branchId);
    return provider;
  }

  async update(
    id: string,
    dto: UpdateStudyProviderDto,
    user: BranchScopedUser,
  ) {
    const provider = await this.findOne(id, user);
    if (dto.name !== undefined) {
      await this.assertNameAvailable(provider.branchId, dto.name, id);
    }

    try {
      return await this.prisma.studyProvider.update({
        where: { id },
        data: dto,
        include: WITH_STUDY_COUNTS,
      });
    } catch (error) {
      handleDatabaseErrors(error, ENTITY_NAME);
    }
  }

  async remove(id: string, user: BranchScopedUser) {
    const provider = await this.findOne(id, user);

    const inUse = provider._count.studies;
    if (inUse > 0) {
      throw new ConflictException(
        `No se puede eliminar el maquilador: lo usan ${inUse} estudio(s) o perfil(es). Desactívalo (isActive = false) en su lugar.`,
      );
    }

    try {
      return await this.prisma.studyProvider.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, ENTITY_NAME);
    }
  }
}
