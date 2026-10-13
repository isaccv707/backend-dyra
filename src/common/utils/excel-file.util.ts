import type { Express } from 'express';
import { BadRequestException } from '@nestjs/common';

const EXCEL_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

export function assertExcelFile(
  file: Express.Multer.File | undefined,
): asserts file is Express.Multer.File {
  if (!file) throw new BadRequestException('El archivo es obligatorio');
  if (!EXCEL_MIME_TYPES.includes(file.mimetype)) {
    throw new BadRequestException(
      'Solo se permite archivo Excel (.xlsx o .xls)',
    );
  }
}
