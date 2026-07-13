import { PrismaClient } from '@prisma/client';
import { AUTHORS } from '../constants/authors';

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ');
const normalizeKey = (name: string) => normalizeName(name).toLowerCase();

export async function seedAuthors(prisma: PrismaClient) {
  for (const author of AUTHORS) {
    const name = normalizeName(author.name);
    const nameKey = normalizeKey(author.name);

    await prisma.author.upsert({
      where: { nameKey },
      update: {
        name,
        avatar: author.avatar,
        bio: author.bio,
      },
      create: {
        name,
        nameKey,
        avatar: author.avatar,
        bio: author.bio,
      },
    });
  }

  console.log('✅ Authors seeded.');
}
