import { Prisma } from '@prisma/client';

/** Prisma client or the client of an interactive transaction. */
export type StudyDb = Prisma.TransactionClient;
