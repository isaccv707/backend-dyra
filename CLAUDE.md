# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rol

API REST + WebSocket de DYRA (laboratorio clínico multi-sucursal). Dueño de la base de datos. **Consumidores:** `../admin-dyra-web` (casi todas las rutas, con JWT, y el socket `/tickets`) y `../dira-astro` (solo rutas `@Public()`). Contexto del sistema: `../CLAUDE.md`.

## Stack

NestJS 11 · Prisma 7 (`@prisma/adapter-pg`, schema multi-archivo) · PostgreSQL 14 (docker) · TypeScript 5.7 · Jest 30 · Socket.IO 4 · `@nestjs/swagger` (plugin CLI) · `@nestjs/schedule` · `@nestjs/throttler` · pdfkit · xlsx · nodemailer · cloudinary. Node 22. Gestor: **yarn 1** (único lockfile `yarn.lock`; no usar npm).

## Comandos

```bash
yarn install
docker compose up -d            # Postgres :5432, datos en ./postgres
yarn start:dev                  # http://localhost:3000/api (watch)
yarn build                      # prisma generate + nest build → dist/
yarn test                       # unit (Jest, *.spec.ts en src/)
npx jest src/studies/studies.service.spec.ts   # un archivo
npx jest -t "nombre del test"                  # un test
yarn test:cov
yarn lint                       # ESLint con --fix (modifica archivos)
yarn lint:check                 # ESLint sin --fix (lo que corre CI)
yarn format                     # Prettier src/ y test/
npx prisma generate             # tras cambiar prisma/schema/*.prisma
yarn db:migrate --name <cambio> # prisma migrate dev: crea y aplica migración en la BD local
yarn db:deploy                  # prisma migrate deploy (lo que corre start:prod)
yarn db:status                  # prisma migrate status
npx prisma db seed              # ts-node prisma/seed.ts
npx prisma studio
yarn openapi:export             # nest build + escribe openapi.json (contrato para los frontends)
```

- `test:e2e` (`test/jest-e2e.json`) no tiene specs hoy (`--passWithNoTests`).
- Seed: siempre roles/permisos, usuario admin (`ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`; se le asignan todas las sucursales existentes) y subcategorías de tickets. Solo si `SEED_DEV_BRANCH=true` y `NODE_ENV!=production`: estados + sucursal por defecto `a1b2c3d4-0001-4000-8000-000000000001` (debe ir antes del admin). **Nunca** activar `SEED_DEV_BRANCH` contra producción: `seedBranches` actualiza la fila si existe.

## Estructura

```
src/<módulo>/        controller, service, dto/, *.spec.ts  (un módulo Nest por feature)
src/auth/            login/OTP/reset, JwtStrategy, guards globales, @Public/@Permissions/@CurrentUser
src/common/          filtro Prisma, handle-db-errors, paginate.util, branch-access.util,
                     slugger.util, excel utils, cors.util, cloudinary/, pdf/
src/mail/            MailService (nodemailer)
src/tickets/         REST + gateway WS /tickets + cron SLA (cada hora)
src/swagger.ts       createOpenApiDocument(): usado por main.ts y src/scripts/export-openapi.ts
openapi.json         contrato generado (versionado; CI falla si está desactualizado)
prisma/schema/       un .prisma por módulo; generator/datasource en schema.prisma
prisma/migrations/   0_init (baseline = schema de main al 2026-10-20) + migraciones nuevas
prisma/migrations-legacy/  historial previo al baseline; solo referencia, Prisma no lo lee
prisma/prisma/       PrismaModule (global) y PrismaService (ruta doblemente anidada)
prisma/seeds/, prisma/constants/   seeds y catálogos (roles-permissions.ts)
prisma/scripts/      backfills one-off de migraciones de datos
src/assets/          logo para PDFs (se copia a dist/assets)
```

Módulos: auth, users, roles-permissions, branches, states, services, studies, study-catalogs, price-sheets, quotations, posts, authors, banners, reviews, employees, locations, devices, safeguards, vehicles, vehicle-safeguards, tickets.

## Patrones y convenciones

- **Bootstrap (`src/main.ts`):** prefijo global `/api`; Swagger en `/api` (`/api-json`) con `createOpenApiDocument()` de `src/swagger.ts` (siempre después de `setGlobalPrefix`); `ValidationPipe({ whitelist, forbidNonWhitelisted })`; `PrismaClientExceptionFilter` (P2002→409, P2025→404, P2003→400); CORS desde `CORS_ORIGINS`; query parser `extended`.
- **Nueva entidad:** modelo en `prisma/schema/<módulo>.prisma` (los modelos se referencian entre archivos sin imports) → `yarn db:migrate --name <cambio>` (genera la migración y el cliente) → `src/<entidad>/` con controller/service/dto → importar en `src/app.module.ts` → permisos en `prisma/constants/roles-permissions.ts`. Imitar `src/services/` o `src/studies/`.
- **DTOs:** `class-validator`; `@Type(() => …)` para anidados y números (los query params llegan como string). Swagger se infiere del DTO; documentar con `@ApiOperation`/`@ApiResponse` como en `services.controller.ts`.
- **Errores:** `handleDatabaseErrors()` (`src/common/handle-db-errors.ts`) en los catch de servicios; mensajes en español (estudios: `handleStudyDbErrors()`).
- **Paginación:** `{ data, total, page, limit, totalPages }` vía `src/common/utils/paginate.util.ts`.
- **Slugs:** `generateSlug()` de `src/common/utils/slugger.util.ts` (posts, services, studies).
- **Permisos:** `@Permissions('módulo:acción')`, guard global en `auth.module.ts`. Rutas abiertas: `@Public()`. Roles sembrados: `Administrador` (todo), `Usuario` (lectura salvo users/roles/permissions + `tickets:create`), `Soporte TI` (Usuario + `tickets:update`). `tickets` solo tiene `create` y `update`.
- **Prisma:** para búsquedas case-insensitive de varios nombres usar `OR` de `equals` + `mode: 'insensitive'`; `in` + `insensitive` está roto con Prisma 7 + adapter-pg.

## Reglas de dominio

**Sucursal (`branchId`):** no existe contenido "global". `Service`, `Author`, `Post`, `Banner`, `PriceSheets`, `Study` tienen un único `branchId` requerido (nunca `Branch[]`); DTOs reciben `branchId`, no `branchIds`; listas filtran con `where.branchId` opcional. Unicidad (`name`/`nameKey`, `slug`, `code`) es por sucursal (`@@unique([branchId, …])`).
- Excepciones: `Review.branchId` es nullable; `User` ↔ `Branch[]` es many-to-many real — escritura y lectura admin se acotan con `assertBranchAccess`/`userBranchFilter` (`src/common/utils/branch-access.util.ts`).
- Validado en servicio, no en BD: `Post.authorId` misma sucursal; `Study.branchId` = la de su `service` (`assertServiceBelongsToBranch`); `StudyOnPriceSheet` solo con tarifarios de la misma sucursal; `Safeguard.branchId` se deriva del empleado.
- `Banner.order` es una cola por `(branchId, placement)`.

**Estudios:**
- `branchId` se fija al crear y nunca cambia (no hay traspasos). Toda escritura y lectura admin valida sucursales del usuario; las lecturas públicas no.
- `DELETE /studies/:id` solo desactiva; reactivar con `PATCH isActive: true`. Lecturas públicas solo devuelven activos; admin usa `/inactive`. Cotizaciones rechazan inactivos.
- `code` se recorta y pasa a mayúsculas. `slug` viene del DTO o de `name`; renombrar no cambia el slug. `title` opcional (default `name`; respuestas usan `studyTitle()`). Slugs únicos por sucursal → `GET /studies/by-slug/:slug?branchId=` (requerido); `/:id` solo acepta UUID. `deliveryTime` en días.
- **Orderable = tiene precio:** activo y con `StudyOnPriceSheet` en un tarifario activo. Público: `GET /studies/orderable` (solo tarifarios públicos); admin: `GET /studies/admin/orderable`.
- `eligiblePatients` (M/F/A, DIAS/AÑOS) se aplana en columnas y `toStudyResponse()` lo reagrupa. `referenceValues[]` son cuantitativos (`minValue`/`maxValue`, `gender` MASCULINO/FEMENINO/AMBOS, `unitAge`) o cualitativos (`text`); reglas en `assertValidReferenceValues()`; enviar la lista la reemplaza completa.
- **Catálogos** (`StudySection`, `SampleType`, `StudyTechnique`, por sucursal): `sectionId` y `sampleTypeId` requeridos al crear y no se pueden limpiar; `techniqueId` opcional (acepta `null`). Un controller factory sirve `/api/study-sections|sample-types|study-techniques`. Nombres únicos case-insensitive (validado en servicio). En uso → no se borran (409), se desactivan. Import masivo `POST /api/study-catalogs/import?branchId=` solo crea (existentes → `skipped`).
- Migración en curso (fase 1): columnas `Study.legacySection/legacySampleType/legacyTechnique` omitidas globalmente en `PrismaService`; solo las lee `prisma/scripts/backfill-study-catalogs.ts`. La fase 2 las elimina **en un deploy posterior** al backfill.
- **Paneles (perfiles):** `isPanel = true` con hijos ordenados vía `StudyPanelItem` (many-to-many, un hijo puede ser panel). Reglas en `src/studies/utils/panel-tree.util.ts`: solo paneles tienen hijos, misma sucursal, sin ciclos/duplicados/autorreferencia, hijos activos, un estudio dentro de un panel no se desactiva, `isPanel` no se apaga con hijos. Reemplazo completo con `PUT /studies/:id/panel-items`; árbol en `GET /studies/:id/panel-tree`. Un panel no tiene `units`/`decimals`/`referenceValues`. Las cotizaciones guardan snapshot en `QuotationItem.components`.
- **Import Excel:** `StudyExcelImportService` (`src/studies/study-excel-import.service.ts`) es compartido por `POST /studies/import?branchId=` (sin precios; fila con `price` → error) y `POST /price-sheets/:id/import-excel` (con precios; `price` vacío no toca el precio). Columna `parametros` (códigos hijos, solo paneles) se aplica al final. Resuelve/auto-crea catálogos con `resolveStudyCatalogIds()`. Slug solo al crear (`assignNewStudySlugs()`). Respuesta: `invalid`, `importErrors`, `panelErrors`, `created`/`updated`.

**Tickets:**
- `branchId` requerido y validado contra las sucursales del creador. Quien no tiene `tickets:update` solo crea y ve/comenta/adjunta los suyos (`createdById`) o donde está asignado — **sin depender de sucursal** (`assertTicketAccess()` omite `assertBranchAccess` a propósito).
- `tickets:update` (Soporte TI) sí está acotado por sucursal: gestiona todos los tickets de sus sucursales, ve notas internas (`TicketComment.isInternal`), cambia estado/prioridad/asignados y entra a la sala socket `ti_staff_room`.
- N asignados (`TicketAssignee`, sin principal): `PUT /tickets/:id/assignees`; candidatos válidos en `GET /tickets/:id/assignable-users` (`assertAssigneesAreValid()`: activos, con acceso a la sucursal, no el creador). Correo al asignar (`ADMIN_APP_URL`), fire-and-forget. Al crear un ticket se avisa (notificación `NEW_TICKET` + correo) a TI activo con `tickets:update` de esa sucursal o global, sin el creador; un fallo del aviso no falla la creación. El cron SLA solo notifica al creador + `ti_staff_room`.

**PDF:** pdfkit en servidor (cotizaciones, resguardos `ADM.F.00` con secciones cómputo/móvil/vehículo; checklist en `src/safeguards/constants/vehicle-inspection-items.const.ts`). Logo desde `dist/assets/`. Documentos firmados: subida directa a Cloudinary con firma generada aquí (el secret nunca sale del backend).

## Variables de entorno (ver `.env.example`)

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión Prisma |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Contenedor Postgres de `docker-compose.yaml` |
| `PORT` | Puerto HTTP (default 3000) |
| `CORS_ORIGINS` | Orígenes permitidos REST + WS, separados por coma |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Firma y vigencia del JWT (default 7d) |
| `ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Usuario admin del seed |
| `SEED_DEV_BRANCH` | `true` = sembrar sucursal de desarrollo (solo local) |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM` | SMTP (OTP, asignación de tickets) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Firma de subidas de documentos firmados |
| `ADMIN_APP_URL` | Base de links en correos (opcional) |

## Integración

- Cambiar una ruta, DTO, forma de respuesta o permiso **obliga a revisar ambos frontends**: `../admin-dyra-web/src/api/` + `src/interfaces/` y `../dira-astro/src/api/` + `src/interfaces/`. Avisar qué se rompe.
- El sitio público solo usa: `GET /studies`, `/studies/by-slug/:slug`, `/studies/:id/panel-tree`, `/services`, `/services/:idOrSlug`, `/branches`, `/branches/:id`, `/posts`, `/banners/active/:placement`, `/reviews/approved`, `POST /quotations/pdf`, `POST /reviews`. Quitar `@Public()` de cualquiera rompe el sitio.
- El gateway WS (`/tickets`) vive fuera de `/api` y autentica con `handshake.auth.token`.

## Migraciones

- Todo cambio de schema va con su migración (`yarn db:migrate --name <cambio>`); CI aplica las migraciones a una BD vacía y falla si difieren del schema. No usar `db push` salvo en una BD local desechable.
- `start:prod` corre `prisma migrate deploy`. Renombrar una columna: editar el SQL generado (`ALTER ... RENAME`) en lugar del DROP + ADD que propone Prisma. Backfill y eliminación de columnas en deploys separados.
- **Corte a migraciones en producción (una sola vez, antes del primer deploy con `migrate deploy`):**
  1. Respaldar la BD de producción.
  2. Con `DATABASE_URL` de prod: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script` debe mostrar **solo** el SQL de `20261020000000_auth_hardening` (si muestra más, prod no está en el schema de `main`: resolver antes).
  3. Verificar que no hay roles duplicados (`SELECT name FROM "Role" GROUP BY name HAVING count(*) > 1`); si los hay, el índice único falla.
  4. `npx prisma migrate resolve --applied 0_init`.
  5. Deploy: `start:prod` aplica `auth_hardening`. Si se omite el paso 4, `migrate deploy` falla y la app no arranca (no toca datos).
- BD local que venía de `db push`: `npx prisma db push` y luego `npx prisma migrate resolve --applied <cada migración>`; o recrearla con `yarn db:deploy` + seed.

## Errores comunes / evitar

- `yarn lint` aplica `--fix`: revisar el diff después.
- No usar npm (genera `package-lock.json`).
- No olvidar `npx prisma generate` tras editar el schema (los tipos de `@prisma/client` quedan viejos).

## Definición de terminado

1. `yarn test` en verde (agregar/ajustar specs del servicio tocado).
2. `yarn lint:check` sin errores y `yarn build` exitoso.
3. Si cambió el schema: migración creada con `yarn db:migrate` y aplicada en local.
4. Si cambió una ruta o DTO: `yarn openapi:export`, commitear `openapi.json`, y en cada frontend afectado `pnpm api:types` + revisar sus interfaces (ver `../CLAUDE.md` §6).

CI (`.github/workflows/ci.yml`, PRs a `dev`/`main`): lint:check, test, build, migraciones vs schema, `openapi.json` al día.
