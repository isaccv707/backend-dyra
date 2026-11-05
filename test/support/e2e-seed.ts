import { PrismaClient } from '@prisma/client';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { seedRolesAndPermissions } from 'prisma/seeds/roles-permissions.seed';
import { seedStates } from 'prisma/seeds/states.seed';

const SEEDED_ROLES = ['Administrador', 'Usuario', 'Soporte TI'];

/**
 * Base data every e2e suite needs: the seeded roles (with their permissions)
 * and the states. CI starts from an empty, migrated database, so each suite
 * ensures them instead of relying on another suite having run first. Both
 * seeds are idempotent; roles are only seeded when one is missing, so a local
 * database keeps its own role permissions.
 */
export async function ensureE2eBaseData(prisma: PrismaService) {
  const db = prisma as unknown as PrismaClient;
  const roles = await prisma.role.count({
    where: { name: { in: SEEDED_ROLES } },
  });
  if (roles < SEEDED_ROLES.length) await seedRolesAndPermissions(db);
  await seedStates(db);
}
