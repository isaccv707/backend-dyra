// ─── Permissions ──────────────────────────────────────────────────────────────

export const PERMISSIONS = [
  // Authors
  { action: 'authors:create', description: 'Crear autores' },
  { action: 'authors:read',   description: 'Leer autores' },
  { action: 'authors:update', description: 'Actualizar autores' },
  { action: 'authors:delete', description: 'Eliminar autores' },

  // Banners
  { action: 'banners:create', description: 'Crear banners' },
  { action: 'banners:read',   description: 'Leer banners' },
  { action: 'banners:update', description: 'Actualizar banners' },
  { action: 'banners:delete', description: 'Eliminar banners' },

  // Branches
  { action: 'branches:create', description: 'Crear sucursales' },
  { action: 'branches:read',   description: 'Leer sucursales' },
  { action: 'branches:update', description: 'Actualizar sucursales' },
  { action: 'branches:delete', description: 'Eliminar sucursales' },

  // Device catalog
  { action: 'device-catalog:create', description: 'Crear modelos de catálogo de equipos' },
  { action: 'device-catalog:read',   description: 'Leer catálogo de equipos' },
  { action: 'device-catalog:update', description: 'Actualizar catálogo de equipos' },
  { action: 'device-catalog:delete', description: 'Eliminar catálogo de equipos' },

  // Devices
  { action: 'devices:create', description: 'Crear equipos (alta de inventario)' },
  { action: 'devices:read',   description: 'Leer equipos de inventario' },
  { action: 'devices:update', description: 'Actualizar equipos de inventario (incluye asignación y retiro)' },
  { action: 'devices:delete', description: 'Eliminar equipos de inventario' },

  // Employees
  { action: 'employees:create', description: 'Crear empleados' },
  { action: 'employees:read',   description: 'Leer empleados' },
  { action: 'employees:update', description: 'Actualizar empleados' },
  { action: 'employees:delete', description: 'Eliminar empleados' },

  // Locations
  { action: 'locations:create', description: 'Crear ubicaciones' },
  { action: 'locations:read',   description: 'Leer ubicaciones' },
  { action: 'locations:update', description: 'Actualizar ubicaciones' },
  { action: 'locations:delete', description: 'Eliminar ubicaciones' },

  // Posts
  { action: 'posts:create', description: 'Crear publicaciones' },
  { action: 'posts:read',   description: 'Leer publicaciones' },
  { action: 'posts:update', description: 'Actualizar publicaciones' },
  { action: 'posts:delete', description: 'Eliminar publicaciones' },

  // Price sheets
  { action: 'price-sheets:create', description: 'Crear listas de precios' },
  { action: 'price-sheets:read',   description: 'Leer listas de precios' },
  { action: 'price-sheets:update', description: 'Actualizar listas de precios' },
  { action: 'price-sheets:delete', description: 'Eliminar listas de precios' },

  // Quotations
  { action: 'quotations:create', description: 'Crear cotizaciones' },
  { action: 'quotations:read',   description: 'Leer cotizaciones' },
  { action: 'quotations:update', description: 'Actualizar cotizaciones' },
  { action: 'quotations:delete', description: 'Eliminar cotizaciones' },

  // Reviews
  { action: 'reviews:create', description: 'Crear reseñas' },
  { action: 'reviews:read',   description: 'Leer reseñas' },
  { action: 'reviews:update', description: 'Actualizar reseñas' },
  { action: 'reviews:delete', description: 'Eliminar reseñas' },

  // Services
  { action: 'services:create', description: 'Crear servicios' },
  { action: 'services:read',   description: 'Leer servicios' },
  { action: 'services:update', description: 'Actualizar servicios' },
  { action: 'services:delete', description: 'Eliminar servicios' },

  // States
  { action: 'states:create', description: 'Crear estados' },
  { action: 'states:read',   description: 'Leer estados' },
  { action: 'states:update', description: 'Actualizar estados' },
  { action: 'states:delete', description: 'Eliminar estados' },

  // Studies
  { action: 'studies:create', description: 'Crear estudios' },
  { action: 'studies:read',   description: 'Leer estudios' },
  { action: 'studies:update', description: 'Actualizar estudios' },
  { action: 'studies:delete', description: 'Eliminar estudios' },

  // Transfers
  { action: 'transfers:create', description: 'Crear solicitudes de transferencia de equipos' },
  { action: 'transfers:read',   description: 'Leer transferencias de equipos' },
  { action: 'transfers:update', description: 'Iniciar, recibir, cancelar o rechazar transferencias' },

  // Users
  { action: 'users:create', description: 'Crear usuarios' },
  { action: 'users:read',   description: 'Leer usuarios' },
  { action: 'users:update', description: 'Actualizar usuarios' },
  { action: 'users:delete', description: 'Eliminar usuarios' },

  // Roles
  { action: 'roles:create', description: 'Crear roles' },
  { action: 'roles:read',   description: 'Leer roles' },
  { action: 'roles:update', description: 'Actualizar roles' },
  { action: 'roles:delete', description: 'Eliminar roles' },

  // Permissions
  { action: 'permissions:create', description: 'Crear permisos' },
  { action: 'permissions:read',   description: 'Leer permisos' },
  { action: 'permissions:update', description: 'Actualizar permisos' },
  { action: 'permissions:delete', description: 'Eliminar permisos' },
];

// ─── Roles ─────────────────────────────────────────────────────────────────────

const USUARIO_EXCLUDED_MODULES = ['users', 'roles', 'permissions'];

export const ROLES = [
  {
    name: 'Administrador',
    description: 'Acceso total: crear, leer, actualizar y eliminar en todos los módulos',
    permissions: PERMISSIONS.map((p) => p.action),
  },
  {
    name: 'Usuario',
    description:
      'Acceso de solo lectura en todos los módulos, excepto usuarios, roles y permisos',
    permissions: PERMISSIONS.filter(
      (p) =>
        p.action.endsWith(':read') &&
        !USUARIO_EXCLUDED_MODULES.some((module) => p.action.startsWith(`${module}:`)),
    ).map((p) => p.action),
  },
];
