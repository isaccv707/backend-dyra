import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { PaginationPostDto } from './dto/pagination-post.dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from 'src/common/utils/slugger.util';
import { branchScopeWhere } from 'src/common/utils/branch-scope.util';
import { buildPaginatedQuery, paginatedResponse } from 'src/common/utils/paginate.util';

const POST_ALLOWED_FIELDS = ['title', 'category', 'status', 'createdAt'];

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createPostDto: CreatePostDto) {
    const { contentBlocks, title, branchIds, ...postData } = createPostDto;
    try {
      return await this.prisma.post.create({
        data: {
          ...postData,
          title,
          slug: generateSlug(title),
          contentBlocks: {
            create: contentBlocks,
          },
          ...(branchIds?.length && {
            branches: { connect: branchIds.map((id) => ({ id })) },
          }),
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
      AND: [where, branchScopeWhere(branchId)],
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

  async findOne(id: string) {
    const post = await this.prisma.post.findFirst({
      where: {
        OR: [
          { id },
          { slug: id }
        ]
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
    const { contentBlocks, title, branchIds, ...postData } = updatePostDto;

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

    if (branchIds !== undefined) {
      dataToUpdate.branches = { set: branchIds.map((id) => ({ id })) };
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

    return `This action updates a #${id} post`;
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
