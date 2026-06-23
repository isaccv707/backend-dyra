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

  // 2. Create roles and assign their permissions
  for (const role of ROLES) {
    const existing = await prisma.role.findFirst({ where: { name: role.name } });
    const { id: roleId } =
      existing ??
      (await prisma.role.create({
        data: { name: role.name, description: role.description },
      }));

    for (const action of role.permissions) {
      const permission = await prisma.permission.findUnique({ where: { action } });
      if (!permission) continue;

      await prisma.rolesOnPermissions.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      });
    }
  }

  console.log('✅ Seeding roles and permissions finished.');
}
