import { PrismaClient } from '@prisma/client';
import slugify from 'slugify';
import { POSTS } from '../constants/posts';

const generateSlug = (text: string) =>
  slugify(text, { lower: true, strict: true, trim: true });

export async function seedPosts(prisma: PrismaClient) {
  for (const post of POSTS) {
    const { authorName, branchNames, contentBlocks, ...postData } = post;
    const slug = generateSlug(post.title);

    const author = await prisma.author.findFirst({ where: { name: authorName } });
    if (!author) {
      throw new Error(
        `Autor '${authorName}' no encontrado. Ejecuta seedAuthors primero.`,
      );
    }

    let branches: { id: string }[] = [];
    if (branchNames?.length) {
      const found = await prisma.branch.findMany({
        where: { name: { in: branchNames } },
        select: { id: true },
      });
      if (found.length !== branchNames.length) {
        throw new Error(
          `No se encontraron todas las sucursales para el post '${post.title}'. Ejecuta seedBranches primero.`,
        );
      }
      branches = found;
    }

    const existing = await prisma.post.findUnique({ where: { slug } });

    if (existing) {
      await prisma.post.update({
        where: { slug },
        data: {
          ...postData,
          authorId: author.id,
          branches: { set: branches.map((b) => ({ id: b.id })) },
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
          branches: branches.length ? { connect: branches.map((b) => ({ id: b.id })) } : undefined,
          contentBlocks: { create: contentBlocks },
        },
      });
    }
  }

  console.log('✅ Posts seeded.');
}
