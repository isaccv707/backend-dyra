import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from 'prisma/prisma/prisma.service';

const STUDY_COLUMNS = [
  'code',
  'name',
  'title',
  'description',
  'sampleType',
  'preparation',
  'serviceName',
  'deliveryTime',
  'isActive',
  'abbreviation',
  'section',
  'technique',
  'isPanel',
  'parametros',
  'gender',
  'ageFormat',
  'minAge',
  'maxAge',
  'units',
  'decimals',
];

/** Excel template for the studies import, with the branch's active services. */
@Injectable()
export class StudyImportTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async generateTemplate(branchId: string): Promise<Buffer> {
    const services = await this.prisma.service.findMany({
      where: { branchId, isActive: true },
      orderBy: { name: 'asc' },
    });

    const exampleRow: Record<string, string | number> = {
      code: 'BH001',
      name: 'Biometría Hemática',
      title: 'Biometría Hemática Completa',
      description: 'Conteo completo de células sanguíneas',
      sampleType: 'Sangre venosa',
      preparation: 'Ayuno de 8 horas',
      serviceName: services[0]?.name ?? 'PEGAR-AQUI-EL-NOMBRE-DEL-SERVICIO',
      deliveryTime: 1,
      isActive: 'true',
      abbreviation: 'BH',
      section: 'Hematología',
      technique: 'Citometría de flujo',
      isPanel: 'false',
      parametros: '',
      gender: 'A',
      ageFormat: 'AÑOS',
      minAge: 0,
      maxAge: 120,
      units: 'g/dL',
      decimals: 2,
    };

    const studiesSheet = XLSX.utils.json_to_sheet([exampleRow], {
      header: STUDY_COLUMNS,
    });

    const servicesSheet = XLSX.utils.json_to_sheet(
      services.map((s) => ({ name: s.name })),
    );

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, studiesSheet, 'Estudios');
    XLSX.utils.book_append_sheet(
      workbook,
      servicesSheet,
      'Servicios (referencia)',
    );

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
