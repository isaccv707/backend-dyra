import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { StudiesService } from 'src/studies/studies.service';
import { UpdateStudyDto } from 'src/studies/dto/update-study.dto';
import { ApplyStudyUpdateFormDto } from '../dto/apply-study-form.dto';
import { StudyUpdateFormDto } from '../dto/study-update-form.dto';
import {
  TicketFormApplyResult,
  TicketFormContext,
  TicketFormDb,
  TicketFormHandler,
} from '../ticket-form-handler.interface';
import { ticketTitle } from '../ticket-forms.const';
import {
  assertIdentitiesMatch,
  assertPanelItemsAllowed,
  assertValidPanelItems,
  createPanelChildren,
} from './study-form-panel.util';

const defined = <T extends object>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;

const toJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function splitForm(data: StudyUpdateFormDto) {
  const {
    studyId,
    studyPrices,
    panelItems,
    baseVersions: _baseVersions,
    ...changes
  } = data;
  return {
    studyId,
    studyPrices,
    panelItems,
    changes: defined(changes) as UpdateStudyDto,
  };
}

/** Lists the request replaces whole: they need a base version (see below). */
const REPLACED_LISTS = [
  'studyPrices',
  'referenceValues',
  'panelItems',
] as const;
type ReplacedList = (typeof REPLACED_LISTS)[number];

const LIST_LABELS: Record<ReplacedList, string> = {
  studyPrices: 'los precios',
  referenceValues: 'los valores de referencia',
  panelItems: 'los estudios del perfil',
};

const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/**
 * Version of each list the request replaces, taken from the study when the
 * request is saved. If it differs when IT approves, someone changed that list
 * in between and applying the request would silently undo it.
 */
async function listVersions(
  db: TicketFormDb,
  studyId: string,
  lists: ReplacedList[],
): Promise<Partial<Record<ReplacedList, string>>> {
  if (!lists.length) return {};
  const study = await db.study.findUniqueOrThrow({
    where: { id: studyId },
    select: {
      priceSheets: {
        orderBy: { priceSheetId: 'asc' },
        select: { priceSheetId: true, price: true, showPrice: true },
      },
      referenceValues: {
        orderBy: { order: 'asc' },
        select: {
          gender: true,
          unitAge: true,
          minAge: true,
          maxAge: true,
          minValue: true,
          maxValue: true,
          text: true,
        },
      },
      panelItems: { orderBy: { order: 'asc' }, select: { childId: true } },
    },
  });
  const source: Record<ReplacedList, unknown> = {
    studyPrices: study.priceSheets,
    referenceValues: study.referenceValues,
    panelItems: study.panelItems,
  };
  return Object.fromEntries(
    lists.map((list) => [list, fingerprint(source[list])]),
  );
}

const replacedLists = (data: StudyUpdateFormDto) =>
  REPLACED_LISTS.filter((list) => data[list] !== undefined);

@Injectable()
export class StudyUpdateFormHandler implements TicketFormHandler<
  StudyUpdateFormDto,
  ApplyStudyUpdateFormDto
> {
  readonly type = 'STUDY_UPDATE' as const;
  readonly dataDto = StudyUpdateFormDto;
  readonly applyDto = ApplyStudyUpdateFormDto;

  constructor(private readonly studies: StudiesService) {}

  async validate(
    data: StudyUpdateFormDto,
    context: TicketFormContext,
    db: TicketFormDb,
  ) {
    const current = await this.assertValid(data, context, db);
    const kind = current.isPanel ? 'perfil' : 'parámetro';
    const lists = replacedLists(data);
    return {
      title: ticketTitle(
        `Actualización de ${kind}`,
        `${current.code} ${current.name}`,
      ),
      // Saving the request (create or edit) takes the current lists as base.
      ...(lists.length && {
        data: { baseVersions: await listVersions(db, data.studyId, lists) },
      }),
    };
  }

  private async assertValid(
    data: StudyUpdateFormDto,
    context: TicketFormContext,
    db: TicketFormDb,
  ) {
    const { studyId, studyPrices, panelItems, changes } = splitForm(data);
    if (
      !Object.keys(changes).length &&
      studyPrices === undefined &&
      panelItems === undefined
    ) {
      throw new BadRequestException(
        'form: indica al menos un dato a actualizar',
      );
    }

    const removesChildren = panelItems?.length === 0;
    const current = await this.studies.assertUpdatable(
      studyId,
      changes,
      context.actor,
      db,
      { childrenWillBeRemoved: removesChildren },
    );
    if (current.branchId !== context.branchId) {
      throw new BadRequestException(
        'form.studyId: el estudio pertenece a otra sucursal distinta a la del ticket',
      );
    }

    const isPanel = changes.isPanel ?? current.isPanel;
    assertPanelItemsAllowed(isPanel, panelItems);
    if (studyPrices) {
      await this.studies.assertPriceSheetsBelongToBranch(
        studyPrices.map((p) => p.priceSheetId),
        current.branchId,
        db,
      );
    }
    if (panelItems?.length) {
      await assertValidPanelItems(
        this.studies,
        studyId,
        panelItems,
        context,
        db,
      );
    }

    return current;
  }

  private async assertListsUnchanged(
    data: StudyUpdateFormDto,
    tx: TicketFormDb,
  ) {
    const base = data.baseVersions ?? {};
    const lists = replacedLists(data).filter((list) => base[list]);
    const current = await listVersions(tx, data.studyId, lists);
    const changed = lists.filter((list) => current[list] !== base[list]);
    if (changed.length) {
      throw new ConflictException(
        `El estudio cambió desde la solicitud (${changed.map((list) => LIST_LABELS[list]).join(', ')}): edita la solicitud para partir de los datos actuales y vuelve a aprobarla`,
      );
    }
  }

  async apply(
    data: StudyUpdateFormDto,
    applyData: ApplyStudyUpdateFormDto,
    context: TicketFormContext,
    tx: TicketFormDb,
  ): Promise<TicketFormApplyResult> {
    await this.assertValid(data, context, tx);
    await this.assertListsUnchanged(data, tx);
    const { studyId, studyPrices, panelItems, changes } = splitForm(data);
    const { newStudies, ...identity } = applyData;
    assertIdentitiesMatch(panelItems, newStudies);

    const before = await tx.study.findUniqueOrThrow({
      where: { id: studyId },
      include: {
        priceSheets: {
          select: { priceSheetId: true, price: true, showPrice: true },
        },
        referenceValues: { orderBy: { order: 'asc' } },
        panelItems: {
          orderBy: { order: 'asc' },
          select: { childId: true },
        },
      },
    });

    // Children go first when un-marking a panel (update rejects a panel with children).
    if (panelItems?.length === 0 && before.isPanel) {
      await this.studies.setPanelItems(
        studyId,
        { items: [] },
        context.actor,
        tx,
      );
    }

    const fields = { ...changes, ...defined(identity) };
    let updated = before;
    if (Object.keys(fields).length) {
      const result = await this.studies.update(
        studyId,
        fields,
        context.actor,
        tx,
      );
      if (result) updated = { ...before, ...result };
    }

    if (studyPrices) {
      await this.studies.replacePrices(studyId, studyPrices, context.actor, tx);
    }

    let created: { id: string; code: string; name: string }[] = [];
    if (panelItems?.length) {
      const children = await createPanelChildren(
        this.studies,
        panelItems,
        newStudies,
        context,
        tx,
      );
      created = children.created;
      await this.studies.setPanelItems(
        studyId,
        { items: children.childIds.map((childId) => ({ childId })) },
        context.actor,
        tx,
      );
    }

    const changedKeys = Object.keys(fields);
    const pick = (source: object, keys: string[]) =>
      Object.fromEntries(
        keys.map((key) => [key, (source as Record<string, unknown>)[key]]),
      );
    const eligibleKeys = ['gender', 'ageFormat', 'minAge', 'maxAge'];

    return {
      result: {
        studyId,
        code: updated.code,
        before: toJson({
          ...pick(
            before,
            changedKeys.flatMap((key) =>
              key === 'eligiblePatients' ? eligibleKeys : [key],
            ),
          ),
          ...(studyPrices && { studyPrices: before.priceSheets }),
          ...(panelItems && {
            panelItems: before.panelItems.map((item) => item.childId),
          }),
        }),
        after: toJson({
          ...fields,
          ...(studyPrices && { studyPrices }),
          ...(panelItems && { panelItems }),
        }),
        createdChildren: created,
      },
      summary: `actualizó el ${before.isPanel ? 'perfil' : 'parámetro'} ${updated.code}`,
    };
  }
}
