import { PrismaClient } from '@prisma/client';
import { STATES } from '../constants/states';

export async function seedStates(prisma: PrismaClient) {
  for (const { name } of STATES) {
    await prisma.state.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}
