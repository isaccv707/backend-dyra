import { BadRequestException } from '@nestjs/common';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

const firstNumber = (message: string) => message.match(/-?\d+(\.\d+)?/)?.[0];

/**
 * Spanish text for class-validator's default (English) messages. The form DTOs
 * reuse the study DTOs, whose decorators keep the defaults; custom messages
 * (already in Spanish) are left as they are.
 */
const SPANISH_MESSAGES: Record<
  string,
  (property: string, message: string) => string
> = {
  isNotEmpty: (p) => `${p} no puede estar vacío`,
  isString: (p) => `${p} debe ser texto`,
  isInt: (p) => `${p} debe ser un número entero`,
  isNumber: (p) => `${p} debe ser un número válido`,
  isPositive: (p) => `${p} debe ser mayor a 0`,
  isBoolean: (p) => `${p} debe ser verdadero o falso`,
  isUUID: (p) => `${p} debe ser un identificador válido`,
  isArray: (p) => `${p} debe ser una lista`,
  isObject: (p) => `${p} debe ser un objeto`,
  isDateString: (p) => `${p} debe ser una fecha válida (AAAA-MM-DD)`,
  isEmail: (p) => `${p} debe ser un correo válido`,
  isEnum: (p) => `${p} tiene un valor no permitido`,
  isIn: (p) => `${p} tiene un valor no permitido`,
  min: (p, m) => `${p} debe ser mayor o igual a ${firstNumber(m)}`,
  max: (p, m) => `${p} debe ser menor o igual a ${firstNumber(m)}`,
  minLength: (p, m) => `${p} debe tener al menos ${firstNumber(m)} caracteres`,
  maxLength: (p, m) =>
    `${p} debe tener como máximo ${firstNumber(m)} caracteres`,
  arrayMinSize: (p, m) =>
    `${p} debe tener al menos ${firstNumber(m)} elemento(s)`,
  arrayMaxSize: (p, m) =>
    `${p} debe tener como máximo ${firstNumber(m)} elemento(s)`,
  whitelistValidation: (p) => `${p} no es un campo permitido`,
};

const isDefaultMessage = (message: string) => /\b(must|should)\b/.test(message);

function toSpanish(
  path: string,
  property: string,
  constraint: string,
  message: string,
) {
  const translate = SPANISH_MESSAGES[constraint];
  if (translate && isDefaultMessage(message)) return translate(path, message);
  // Custom message: show the full path instead of the bare property name.
  return message.startsWith(property)
    ? `${path}${message.slice(property.length)}`
    : `${path}: ${message}`;
}

function flattenErrors(errors: ValidationError[], parentPath = ''): string[] {
  return errors.flatMap((error) => {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = Object.entries(error.constraints ?? {}).map(
      ([constraint, message]) =>
        toSpanish(path, error.property, constraint, message),
    );
    return [...own, ...flattenErrors(error.children ?? [], path)];
  });
}

/**
 * Same rules as the global ValidationPipe, for payloads whose DTO depends on
 * runtime data (the ticket's form type). Errors carry the field path
 * (`form.panelItems.0.newStudy.name ...`) and are in Spanish.
 */
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
    // The instance is always `dto`; an apply DTO with nothing to capture has
    // no decorators, and any field sent to it is still rejected above.
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    throw new BadRequestException(flattenErrors(errors, path));
  }

  return instance;
}
