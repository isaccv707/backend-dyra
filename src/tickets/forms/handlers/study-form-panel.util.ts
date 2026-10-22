import { BadRequestException } from '@nestjs/common';
import { StudiesService } from 'src/studies/studies.service';
import { StudyIdentityDto } from '../dto/apply-study-form.dto';
import { StudyFormPanelItemDto } from '../dto/study-create-form.dto';
import {
  TicketFormContext,
  TicketFormDb,
} from '../ticket-form-handler.interface';

export function assertPanelItemsAllowed(
  isPanel: boolean,
  panelItems: StudyFormPanelItemDto[] | undefined,
) {
  if (!isPanel && panelItems?.length) {
    throw new BadRequestException(
      'form.panelItems solo aplica a un perfil (isPanel = true)',
    );
  }
}

/** Existing children follow the panel rules; new ones, the study rules. */
export async function assertValidPanelItems(
  studies: StudiesService,
  panelId: string | null,
  items: StudyFormPanelItemDto[],
  { branchId }: TicketFormContext,
  db: TicketFormDb,
) {
  items.forEach((item, index) => {
    if (!item.studyId === !item.newStudy) {
      throw new BadRequestException(
        `form.panelItems[${index}]: indica studyId (estudio existente) o newStudy (parámetro nuevo), solo uno`,
      );
    }
  });

  const existingIds = items.flatMap((item) =>
    item.studyId ? [item.studyId] : [],
  );
  await studies.assertValidPanelChildren(panelId, branchId, existingIds, db);

  // All the new parameters at once: a fixed number of queries per panel.
  await studies.assertCreatableMany(
    items.flatMap((item, index) =>
      item.newStudy
        ? [
            {
              label: `form.panelItems[${index}].newStudy`,
              dto: { ...item.newStudy, branchId, isPanel: false },
            },
          ]
        : [],
    ),
    branchId,
    db,
  );
}

export const countNewStudies = (items: StudyFormPanelItemDto[] = []) =>
  items.filter((item) => item.newStudy).length;

export function assertIdentitiesMatch(
  items: StudyFormPanelItemDto[] | undefined,
  identities: StudyIdentityDto[] | undefined,
) {
  const expected = countNewStudies(items);
  if ((identities?.length ?? 0) !== expected) {
    throw new BadRequestException(
      `newStudies debe traer ${expected} elemento(s): code (y opcionalmente title, abbreviation, slug) de cada parámetro nuevo del perfil, en orden`,
    );
  }
}

/**
 * Creates the new children in one batch and returns every child id in panel
 * order (existing studies keep their place).
 */
export async function createPanelChildren(
  studies: StudiesService,
  items: StudyFormPanelItemDto[],
  identities: StudyIdentityDto[] = [],
  { branchId, actor }: TicketFormContext,
  tx: TicketFormDb,
) {
  let next = 0;
  const newChildren = items.flatMap((item, index) =>
    item.newStudy
      ? [
          {
            label: `form.panelItems[${index}].newStudy`,
            dto: {
              ...item.newStudy,
              ...identities[next++],
              branchId,
              isPanel: false,
            },
          },
        ]
      : [],
  );
  const created = await studies.createMany(newChildren, actor, tx);

  let createdIndex = 0;
  const childIds = items.map((item) =>
    item.studyId ? item.studyId : created[createdIndex++].id,
  );
  return { childIds, created };
}
