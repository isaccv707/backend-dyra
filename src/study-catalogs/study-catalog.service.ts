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
import { CreateStudyCatalogDto } from './dto/create-study-catalog.dto';
import { UpdateStudyCatalogDto } from './dto/update-study-catalog.dto';
import { FindStudyCatalogsDto } from './dto/find-study-catalogs.dto';
import { STUDY_CATALOGS, StudyCatalogConfig } from './study-catalog.config';
import {
  StudyCatalogDelegate,
  studyCatalogDelegate,
} from './utils/study-catalog.util';

const CATALOG_ALLOWED_FIELDS = ['name', 'isActive', 'createdAt'];

@Injectable()
abstract class StudyCatalogService {
  protected abstract readonly config: StudyCatalogConfig;

  constructor(protected readonly prisma: PrismaService) {}

  private get delegate(): StudyCatalogDelegate {
    return studyCatalogDelegate(this.prisma, this.config.kind);
  }

  private async assertNameAvailable(
    branchId: string,
    name: string,
    excludeId?: number,
  ) {
    const duplicate = await this.delegate.findFirst({
      where: {
        branchId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId !== undefined && { NOT: { id: excludeId } }),
      },
    });
    if (duplicate) {
      throw new ConflictException(
        `Ya existe ${this.config.label} "${duplicate.name}" en esta sucursal`,
      );
    }
  }

  async create(dto: CreateStudyCatalogDto, user: BranchScopedUser) {
    assertBranchAccess(user, dto.branchId);

    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branchId },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundException(`Branch with ID '${dto.branchId}' not found`);
    }
    await this.assertNameAvailable(dto.branchId, dto.name);

    try {
      return await this.delegate.create({ data: dto });
    } catch (error) {
      handleDatabaseErrors(error, this.config.entityName);
    }
  }

  async findAll(dto: FindStudyCatalogsDto, user: BranchScopedUser) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name'],
      defaultSort: { name: 'asc' },
      allowedFields: CATALOG_ALLOWED_FIELDS,
    });

    const finalWhere = {
      ...where,
      ...userBranchFilter(user, dto.branchId),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };

    const [data, total] = await Promise.all([
      this.delegate.findMany({
        skip,
        take,
        where: finalWhere,
        orderBy,
        include: { _count: { select: { studies: true } } },
      }),
      this.delegate.count({ where: finalWhere }),
    ]);

    return paginatedResponse(data, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: number, user: BranchScopedUser) {
    const item = await this.delegate.findUnique({
      where: { id },
      include: { _count: { select: { studies: true } } },
    });
    if (!item) {
      throw new NotFoundException(
        `${this.config.entityName} with ID '${id}' not found`,
      );
    }
    assertBranchAccess(user, item.branchId);
    return item;
  }

  async update(id: number, dto: UpdateStudyCatalogDto, user: BranchScopedUser) {
    const item = await this.findOne(id, user);
    if (dto.name !== undefined) {
      await this.assertNameAvailable(item.branchId, dto.name, id);
    }

    try {
      return await this.delegate.update({ where: { id }, data: dto });
    } catch (error) {
      handleDatabaseErrors(error, this.config.entityName);
    }
  }

  async remove(id: number, user: BranchScopedUser) {
    await this.findOne(id, user);

    const inUse = await this.prisma.study.count({
      where: { [this.config.studyField]: id },
    });
    if (inUse > 0) {
      throw new ConflictException(
        `No se puede eliminar ${this.config.label}: está en uso por ${inUse} estudio(s). Desactiva el registro (isActive = false) en su lugar.`,
      );
    }

    try {
      return await this.delegate.delete({ where: { id } });
    } catch (error) {
      handleDatabaseErrors(error, this.config.entityName);
    }
  }
}

@Injectable()
export class StudySectionsService extends StudyCatalogService {
  protected readonly config = STUDY_CATALOGS.section;
}

@Injectable()
export class SampleTypesService extends StudyCatalogService {
  protected readonly config = STUDY_CATALOGS.sampleType;
}

@Injectable()
export class StudyTechniquesService extends StudyCatalogService {
  protected readonly config = STUDY_CATALOGS.technique;
}
