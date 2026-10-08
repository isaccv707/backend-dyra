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
  });

  describe('UpdateStudyDto', () => {
    it('permite omitir los catálogos', async () => {
      const { errors } = await validate(UpdateStudyDto, { name: 'Glucosa' });

      expect(errors).toEqual([]);
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
