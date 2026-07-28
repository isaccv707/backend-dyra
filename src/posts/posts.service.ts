import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { PaginationPostDto } from './dto/pagination-post.dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from 'src/common/utils/slugger.util';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';

const POST_ALLOWED_FIELDS = ['title', 'category', 'status', 'createdAt'];

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) { }

  private async assertAuthorBelongsToBranch(authorId: string, branchId: string) {
    const author = await this.prisma.author.findUnique({
      where: { id: authorId },
      select: { branchId: true },
    });
    if (!author) {
      throw new NotFoundException(`Author with id ${authorId} not found`);
    }
    if (author.branchId !== branchId) {
      throw new BadRequestException(
        'El autor seleccionado pertenece a otra sucursal',
      );
    }
  }

  async create(createPostDto: CreatePostDto) {
    const { contentBlocks, title, branchId, authorId, ...postData } = createPostDto;

    if (authorId) {
      await this.assertAuthorBelongsToBranch(authorId, branchId);
    }

    try {
      return await this.prisma.post.create({
        data: {
          ...postData,
          authorId,
          branchId,
          title,
          slug: generateSlug(title),
          contentBlocks: {
            create: contentBlocks,
          },
        },
        include: {
          contentBlocks: {
            orderBy: { order: "asc" },
          },
          author: {
            select: { id: true, name: true, avatar: true, }
          }
        }
      })
    } catch (error) {
      handleDatabaseErrors(error, 'Post');
    }
  }

  async findAll(dto: PaginationPostDto) {
    const { status, category, tag, branchId } = dto;
    const { skip, take, where, orderBy } = buildPaginatedQuery(dto, {
      searchFields: ['title', 'description'],
      allowedFields: POST_ALLOWED_FIELDS,
    });

    const whereClause: Prisma.PostWhereInput = {
      ...where,
      ...(branchId && { branchId }),
      ...(status && { status }),
      ...(category && { category }),
      ...(tag && { tags: { has: tag } }),
    };

    const [posts, total] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where: whereClause,
        skip,
        take,
        orderBy,
        include: {
          author: {
            select: { id: true, name: true, avatar: true },
          },
        },
      }),
      this.prisma.post.count({ where: whereClause }),
    ]);

    return paginatedResponse(posts, total, dto.page ?? 1, dto.limit ?? 10);
  }

  async findOne(id: string, branchId?: string) {
    const post = await this.prisma.post.findFirst({
      where: {
        OR: [
          { id },
          { slug: id }
        ],
        ...(branchId && { branchId }),
      },
      include: {
        author: {
          select: { id: true, name: true, avatar: true, bio: true },
        },
        contentBlocks: {
          orderBy: { order: 'asc' },
        },
      }
    })
    if (!post) {
      throw new NotFoundException(`Post with identifier '${id}' not found`);
    }
    return post;
  }

  async update(id: string, updatePostDto: UpdatePostDto) {
    const { contentBlocks, title, branchId, authorId, ...postData } = updatePostDto;

    const existingPost = await this.prisma.post.findUnique({ where: { id } });
    if (!existingPost) {
      throw new NotFoundException(`Post with id ${id} not found`);
    }

    const effectiveBranchId = branchId ?? existingPost.branchId;
    const effectiveAuthorId = authorId !== undefined ? authorId : existingPost.authorId;
    if (effectiveAuthorId) {
      await this.assertAuthorBelongsToBranch(effectiveAuthorId, effectiveBranchId);
    }

    const dataToUpdate: any = { ...postData };
    if (title) {
      dataToUpdate.title = title;
      dataToUpdate.slug = generateSlug(title);
    }

    if (contentBlocks) {
      dataToUpdate.contentBlocks = {
        deleteMany: {},
        create: contentBlocks,
      }
    }

    if (branchId) {
      dataToUpdate.branchId = branchId;
    }

    if (authorId !== undefined) {
      dataToUpdate.authorId = authorId;
    }

    try {
      return await this.prisma.post.update({
        where: { id },
        data: dataToUpdate,
        include: {
          contentBlocks: {
            orderBy: { order: 'asc' },
          },
          author: {
            select: { id: true, name: true, avatar: true },
          }
        },
      })
    } catch (error: any) {
      handleDatabaseErrors(error, 'Post');
    }
  }

  async remove(id: string) {
    try {
      const [deleteBlocks, deletedPost] = await this.prisma.$transaction([
        this.prisma.contentBlock.deleteMany({ where: { postId: id } }),
        this.prisma.post.delete({ where: { id }, select: { id: true, title: true } })
      ])
      return {
        message: `Post '${deletedPost.title}' and its ${deleteBlocks.count} content blocks have been deleted successfully.`,
        deletedId: deletedPost.id,
      }
    } catch (error: any) {
      handleDatabaseErrors(error, 'Post');
    }
  }
}
