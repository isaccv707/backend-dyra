// src/prisma/prisma.service.ts
import 'dotenv/config'; // 👈 IMPORTANTE: carga .env al inicio

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not defined');
    }

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    const adapter = new PrismaPg(pool);

    super({
      adapter,
      // Columnas de texto previas a los catálogos de estudio (fase 1 de la
      // migración): solo las lee prisma/scripts/backfill-study-catalogs.ts.
      // Quitar junto con los campos legacy* del schema en la fase 2.
      omit: {
        study: {
          legacySection: true,
          legacySampleType: true,
          legacyTechnique: true,
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
