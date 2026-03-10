import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { handleDatabaseErrors } from 'src/common/handle-db-errors';
import { PaginationPostDto } from './dto/pagination-post.dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from 'src/common/utils/slugger.util';

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createPostDto: CreatePostDto) {
    const { contentBlocks, title, ...postData } = createPostDto;
    try {
      return await this.prisma.post.create({
        data: {
          ...postData,
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

  async findAll(PaginationPostDto: PaginationPostDto) {
    const { page = 1, limit = 10, search, status, category, tag } = PaginationPostDto;
    const skip = (page - 1) * limit;

    const whereClause: Prisma.PostWhereInput = {
      ...(status && { status }),
      ...(category && { category }),
      ...(tag && { tags: { has: tag } }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          author: {
            select: { id: true, name: true, avatar: true },
          },
        },
      }),
      this.prisma.post.count({ where: whereClause }),
    ]);

    return {
      data: posts,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit),
        limit,
        totalPages: Math.ceil(total / limit)
      },
    };
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
    const { contentBlocks, title, ...postData } = updatePostDto;

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
