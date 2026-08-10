import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLES } from '../constants/roles-permissions';

export async function seedRolesAndPermissions(prisma: PrismaClient) {
  // 1. Upsert all permissions
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { action: perm.action },
      update: { description: perm.description },
      create: perm,
    });
  }

  // 2. Create or update roles and assign their permissions via implicit M:M
  for (const roleData of ROLES) {
    const permissionsToConnect = await prisma.permission.findMany({
      where: { action: { in: roleData.permissions } },
      select: { id: true },
    });

    const existing = await prisma.role.findFirst({
      where: { name: roleData.name },
    });

    if (existing) {
      await prisma.role.update({
        where: { id: existing.id },
        data: {
          description: roleData.description,
          permissions: { set: permissionsToConnect },
        },
      });
    } else {
      await prisma.role.create({
        data: {
          name: roleData.name,
          description: roleData.description,
          permissions: { connect: permissionsToConnect },
        },
      });
    }
  }

  console.log('✅ Seeding roles and permissions finished.');
}
