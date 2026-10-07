import { BadRequestException } from '@nestjs/common';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

function flattenErrors(errors: ValidationError[], parentPath = ''): string[] {
  return errors.flatMap((error) => {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) =>
      parentPath ? `${parentPath}.${message}` : message,
    );
    return [...own, ...flattenErrors(error.children ?? [], path)];
  });
}

export async function validateFormPayload<T extends object>(
  dto: ClassConstructor<T>,
  payload: unknown,
  path = '',
): Promise<T> {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new BadRequestException([`${path || 'body'} debe ser un objeto`]);
  }

  const instance = plainToInstance(dto, payload);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  if (errors.length > 0) {
    throw new BadRequestException(flattenErrors(errors, path));
  }

  return instance;
}
