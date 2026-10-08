import { ValidationPipe } from '@nestjs/common';
import { CreateStudyDto } from './create-study.dto';
import { UpdateStudyDto } from './update-study.dto';

describe('Study DTOs: catálogos', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  const validate = async (dto: object, body: object) => {
    try {
      return {
        value: (await pipe.transform(body, {
          type: 'body',
          metatype: dto as new () => object,
        })) as Record<string, unknown>,
        errors: [] as string[],
      };
    } catch (error) {
      const { message } = (
        error as { getResponse: () => { message: string[] } }
      ).getResponse();
      return { value: undefined, errors: message };
    }
  };

  const baseStudy = {
    name: 'Glucosa',
    code: 'GLU',
    serviceId: '11111111-1111-4111-8111-111111111111',
    branchId: '22222222-2222-4222-8222-222222222222',
  };

  describe('CreateStudyDto', () => {
    it('exige sectionId, sampleTypeId y techniqueId', async () => {
      const { errors } = await validate(CreateStudyDto, baseStudy);

      expect(errors).toEqual(
        expect.arrayContaining([
          'sectionId must be an integer number',
          'sampleTypeId must be an integer number',
          'techniqueId must be an integer number',
        ]),
      );
    });

    it('rechaza null en los catálogos', async () => {
      const { errors } = await validate(CreateStudyDto, {
        ...baseStudy,
        sectionId: null,
        sampleTypeId: 2,
        techniqueId: 3,
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every((e) => e.startsWith('sectionId '))).toBe(true);
    });

    it('acepta los tres ids del catálogo', async () => {
      const { errors, value } = await validate(CreateStudyDto, {
        ...baseStudy,
        sectionId: 1,
        sampleTypeId: 2,
        techniqueId: 3,
      });

      expect(errors).toEqual([]);
      expect(value).toMatchObject({
        sectionId: 1,
        sampleTypeId: 2,
        techniqueId: 3,
      });
    });

    it('ya no acepta los textos libres section, sampleType ni technique', async () => {
      const { errors } = await validate(CreateStudyDto, {
        ...baseStudy,
        sectionId: 1,
        sampleTypeId: 2,
        techniqueId: 3,
        section: 'Química',
      });

      expect(errors).toEqual(['property section should not exist']);
    });

    const withCatalogs = {
      ...baseStudy,
      sectionId: 1,
      sampleTypeId: 2,
      techniqueId: 3,
    };

    it('normaliza code con trim y mayúsculas', async () => {
      const { errors, value } = await validate(CreateStudyDto, {
        ...withCatalogs,
        code: '  glu ',
      });

      expect(errors).toEqual([]);
      expect(value).toMatchObject({ code: 'GLU' });
    });

    it('rechaza un code que solo tiene espacios', async () => {
      const { errors } = await validate(CreateStudyDto, {
        ...withCatalogs,
        code: '   ',
      });

      expect(errors).toContain('code should not be empty');
    });

    it('acepta un slug con mayúsculas: el service lo normaliza', async () => {
      const { errors } = await validate(CreateStudyDto, {
        ...withCatalogs,
        slug: 'Glucosa Sérica',
      });

      expect(errors).toEqual([]);
    });

    it('ya no acepta title ni isOrderable', async () => {
      const { errors } = await validate(CreateStudyDto, {
        ...withCatalogs,
        title: 'Glucosa sérica',
        isOrderable: true,
      });

      expect(errors).toEqual([
        'property title should not exist',
        'property isOrderable should not exist',
      ]);
    });

    it('rechaza gender/ageFormat sueltos: van dentro de eligiblePatients', async () => {
      const { errors } = await validate(CreateStudyDto, {
        ...withCatalogs,
        gender: 'M',
        minAge: 18,
      });

      expect(errors).toEqual([
        'property gender should not exist',
        'property minAge should not exist',
      ]);
    });

    it('valida eligiblePatients anidado', async () => {
      const { errors } = await validate(CreateStudyDto, {
        ...withCatalogs,
        eligiblePatients: { gender: 'X', ageFormat: 'AÑOS', minAge: -1 },
      });

      expect(errors).toEqual(
        expect.arrayContaining([
          'eligiblePatients.gender debe ser uno de: M, F, A',
          'eligiblePatients.minAge must not be less than 0',
        ]),
      );
    });

    it('acepta units, decimals, eligiblePatients y referenceValues de ambos tipos', async () => {
      const { errors } = await validate(CreateStudyDto, {
        ...withCatalogs,
        units: 'mg/dL',
        decimals: 1,
        eligiblePatients: { gender: 'F', ageFormat: 'AÑOS', minAge: 18 },
        referenceValues: [
          {
            gender: 'FEMENINO',
            unitAge: 'Años',
            minAge: 18,
            maxAge: 60,
            minValue: 70,
            maxValue: 99.5,
            date: '2026-10-01',
          },
          { text: 'NEGATIVO' },
        ],
      });

      expect(errors).toEqual([]);
    });

    it('valida los enums de referenceValues', async () => {
      const { errors } = await validate(CreateStudyDto, {
        ...withCatalogs,
        referenceValues: [
          { gender: 'M', unitAge: 'AÑOS', minValue: 1, date: 'ayer' },
        ],
      });

      expect(errors).toEqual(
        expect.arrayContaining([
          'referenceValues.0.gender debe ser uno de: MASCULINO, FEMENINO, AMBOS',
          'referenceValues.0.unitAge debe ser uno de: Años, Dias',
          'referenceValues.0.date must be a valid ISO 8601 date string',
        ]),
      );
    });
  });

  describe('UpdateStudyDto', () => {
    it('permite omitir los catálogos', async () => {
      const { errors } = await validate(UpdateStudyDto, { name: 'Glucosa' });

      expect(errors).toEqual([]);
    });

    it('no permite cambiar branchId', async () => {
      const { errors } = await validate(UpdateStudyDto, {
        branchId: '33333333-3333-4333-8333-333333333333',
      });

      expect(errors).toEqual(['property branchId should not exist']);
    });

    it('también normaliza code', async () => {
      const { value } = await validate(UpdateStudyDto, { code: ' bh01 ' });

      expect(value).toEqual({ code: 'BH01' });
    });

    it('permite cambiarlos por otro id', async () => {
      const { errors, value } = await validate(UpdateStudyDto, {
        techniqueId: 7,
      });

      expect(errors).toEqual([]);
      expect(value).toEqual({ techniqueId: 7 });
    });

    it('no permite quitarlos con null', async () => {
      const { errors } = await validate(UpdateStudyDto, {
        sectionId: null,
        sampleTypeId: null,
      });

      expect(errors).toEqual(
        expect.arrayContaining([
          'sectionId must be an integer number',
          'sampleTypeId must be an integer number',
        ]),
      );
    });
  });
});
