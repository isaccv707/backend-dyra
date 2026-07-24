import { PrismaClient } from '@prisma/client';
import { AUTHORS } from '../constants/authors';

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ');
const normalizeKey = (name: string) => normalizeName(name).toLowerCase();

export async function seedAuthors(prisma: PrismaClient) {
  for (const author of AUTHORS) {
    const name = normalizeName(author.name);
    const nameKey = normalizeKey(author.name);

    const branch = await prisma.branch.findFirst({
      where: { name: author.branchName },
    });
    if (!branch) {
      throw new Error(
        `Sucursal '${author.branchName}' no encontrada. Ejecuta seedBranches primero.`,
      );
    }

    await prisma.author.upsert({
      where: { branchId_nameKey: { branchId: branch.id, nameKey } },
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
        branchId: branch.id,
      },
    });
  }

  console.log('✅ Authors seeded.');
}
