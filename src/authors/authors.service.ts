import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateAuthorDto } from './dto/create-author.dto';
import { normalizeKey, normalizeName } from './utils/normalize-name';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { PaginationAuthorDto } from './dto/pagination-author.dto';
import { UpdateAuthorDto } from './dto/update-author.dto';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';

@Injectable()
export class AuthorsService {
  constructor(private readonly prisma: PrismaService) { }

  async createAuthor({ avatar, name: nameAuthor, bio }: CreateAuthorDto) {
    const name = normalizeName(nameAuthor);
    const nameKey = normalizeKey(nameAuthor)

    try {
      return await this.prisma.author.create({
        data: {
          name,
          nameKey,
          avatar: avatar?.trim(),
          bio: bio?.trim(),
        },
        select: {
          id: true,
          name: true,
          avatar: true,
          bio: true,
          createdAt: true,
          updatedAt: true,
        }
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('There is already an author with that name')
      }
      throw error;
    }
  }

  async findAllAuthors({ limit = 10, page = 1, search }: PaginationAuthorDto) {
    const skip = (page - 1) * limit;

    const where: Prisma.AuthorWhereInput | undefined = search
      ? {
          OR: [
            { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { nameKey: { contains: search, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : undefined;

    const [authors, total] = await Promise.all([
      this.prisma.author.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          avatar: true,
          bio: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.author.count({ where }),
    ]);

    return {
      data: authors,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
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
    const dataToUpdate: any = { ...updateAuthorDto };

    // 2. Si viene el nombre, guardamos los valores normalizados en el nuevo objeto
    if (updateAuthorDto.name) {
      dataToUpdate.name = normalizeName(updateAuthorDto.name);
      dataToUpdate.nameKey = normalizeKey(updateAuthorDto.name);
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
