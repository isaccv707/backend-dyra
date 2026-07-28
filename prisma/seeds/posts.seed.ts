import { PrismaClient } from '@prisma/client';
import slugify from 'slugify';
import { POSTS } from '../constants/posts';

const generateSlug = (text: string) =>
  slugify(text, { lower: true, strict: true, trim: true });

export async function seedPosts(prisma: PrismaClient) {
  for (const post of POSTS) {
    const { authorName, branchName, contentBlocks, ...postData } = post;
    const slug = generateSlug(post.title);

    const branch = await prisma.branch.findFirst({ where: { name: branchName } });
    if (!branch) {
      throw new Error(
        `Sucursal '${branchName}' no encontrada. Ejecuta seedBranches primero.`,
      );
    }

    const author = await prisma.author.findFirst({
      where: { name: authorName, branchId: branch.id },
    });
    if (!author) {
      throw new Error(
        `Autor '${authorName}' no encontrado en '${branchName}'. Ejecuta seedAuthors primero.`,
      );
    }

    const existing = await prisma.post.findUnique({
      where: { branchId_slug: { branchId: branch.id, slug } },
    });

    if (existing) {
      await prisma.post.update({
        where: { branchId_slug: { branchId: branch.id, slug } },
        data: {
          ...postData,
          authorId: author.id,
          branchId: branch.id,
          contentBlocks: {
            deleteMany: {},
            create: contentBlocks,
          },
        },
      });
    } else {
      await prisma.post.create({
        data: {
          ...postData,
          slug,
          authorId: author.id,
          branchId: branch.id,
          contentBlocks: { create: contentBlocks },
        },
      });
    }
  }

  console.log('✅ Posts seeded.');
}
