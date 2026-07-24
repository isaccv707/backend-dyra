import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateAuthorDto } from './dto/create-author.dto';
import { normalizeKey, normalizeName } from './utils/normalize-name';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { PaginationAuthorDto } from './dto/pagination-author.dto';
import { UpdateAuthorDto } from './dto/update-author.dto';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';

const AUTHOR_ALLOWED_FIELDS = ['name', 'nameKey', 'createdAt'];

@Injectable()
export class AuthorsService {
  constructor(private readonly prisma: PrismaService) { }

  async createAuthor({ avatar, name: nameAuthor, bio, branchId }: CreateAuthorDto) {
    const name = normalizeName(nameAuthor);
    const nameKey = normalizeKey(nameAuthor)

    try {
      return await this.prisma.author.create({
        data: {
          name,
          nameKey,
          avatar: avatar?.trim(),
          bio: bio?.trim(),
          branch: { connect: { id: branchId } },
        },
        select: {
          id: true,
          name: true,
          avatar: true,
          bio: true,
          branchId: true,
          createdAt: true,
          updatedAt: true,
        }
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ya existe un autor con ese nombre en esta sucursal')
      }
      handleDatabaseErrors(error, 'Author');
    }
  }

  async findAllAuthors(dto: PaginationAuthorDto) {
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['name', 'nameKey'],
      allowedFields: AUTHOR_ALLOWED_FIELDS,
    });

    const whereClause = {
      ...where,
      ...(dto.branchId && { branchId: dto.branchId }),
    } as Prisma.AuthorWhereInput;

    const [authors, total] = await this.prisma.$transaction([
      this.prisma.author.findMany({
        where: whereClause,
        skip,
        take,
        orderBy,
        select: {
          id: true,
          name: true,
          avatar: true,
          bio: true,
          branchId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.author.count({ where: whereClause }),
    ]);

    return paginatedResponse(authors, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOneAuthor(id: string) {
    const author = await this.prisma.author.findFirst({
      where: {
        OR: [
          { id },
          { nameKey: id }
        ]
      }
    })
    if (!author) {
      throw new NotFoundException(`Author with id ${id} not found`)
    }
    return author;
  }

  async updateAuthor(id: string, updateAuthorDto: UpdateAuthorDto) {
    const { branchId, ...rest } = updateAuthorDto;
    const dataToUpdate: any = { ...rest };

    // 2. Si viene el nombre, guardamos los valores normalizados en el nuevo objeto
    if (updateAuthorDto.name) {
      dataToUpdate.name = normalizeName(updateAuthorDto.name);
      dataToUpdate.nameKey = normalizeKey(updateAuthorDto.name);
    }

    if (branchId) {
      dataToUpdate.branch = { connect: { id: branchId } };
    }

    try {
      return await this.prisma.author.update({
        where: { id },
        data: dataToUpdate,
        select: {
          id: true,
          name: true,
          avatar: true,
          bio: true,
          branchId: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    } catch (error) {
      handleDatabaseErrors(error, 'Author')
    }
  }

  async deleteAuthor(id: string) {
    try {
      const deleteAuthor = await this.prisma.author.delete({
        where: { id },
        select: {
          id: true,
          name: true,
        },
      })

      return {
        message: `Author ${deleteAuthor.id} has ben successfuly deleted`,
        deleteId: deleteAuthor.id,
      }
    } catch (error) {
      handleDatabaseErrors(error, 'Author')
    }
  }
}
