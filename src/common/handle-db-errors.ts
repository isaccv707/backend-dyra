import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getUniqueViolationFields } from './utils/unique-violation-fields';

export interface DatabaseErrorMessages {
  notFound?: string;
  conflict?: (fields: string[]) => string | undefined;
  foreignKey?: string;
}

export const handleDatabaseErrors = (
  error: any,
  entityName: string = 'Record',
  messages: DatabaseErrorMessages = {},
) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      throw new NotFoundException(
        messages.notFound ?? `${entityName} not found`,
      );
    }
    if (error.code === 'P2002') {
      const fields = getUniqueViolationFields(error);
      const custom = messages.conflict?.(fields);
      if (custom) throw new ConflictException(custom);
      throw new ConflictException(
        fields.length
          ? `There is already an ${entityName.toLocaleLowerCase()} with that unique value (${fields.join(', ')})`
          : `There is already an ${entityName.toLocaleLowerCase()} with that unique value`,
      );
    }
    if (error.code === 'P2003') {
      throw new BadRequestException(
        messages.foreignKey ??
          `Cannot delete ${entityName} because it has related records (e.g., posts)`,
      );
    }
  }

  if (error instanceof HttpException) {
    throw error;
  }

  console.log(error);
  throw new InternalServerErrorException('Unexpected error, check server logs');
};
