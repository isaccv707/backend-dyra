import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { ImportRowError, ValidStudyImportRow } from '../types/importRow';
import { findPanelsInCycle, loadPanelGraph } from '../utils/panel-tree.util';
import { importErrorMessage } from '../utils/study-import-error.util';

const CYCLE_ERROR =
  'Los parámetros forman un ciclo: algún perfil hijo contiene (directa o indirectamente) a este perfil';

/** Replaces the children of the imported panels (column `parametros`). */
@Injectable()
export class StudyImportPanelsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Before anything is saved: moves to `invalid` the panel rows whose
   * `parametros` close a cycle, with the branch's current panels or with other
   * rows of the file. Checked by code, so studies the file creates count too.
   */
  async rejectCyclicPanels(
    branchId: string,
    valid: ValidStudyImportRow[],
    invalid: ImportRowError[],
  ) {
    const panelRows = valid.filter((v) => v.panelCodes?.length);
    if (!panelRows.length) return;

    const linksById = await loadPanelGraph(this.prisma, branchId);
    const linkedIds = [
      ...new Set([...linksById.keys(), ...[...linksById.values()].flat()]),
    ];
    const codeById = new Map(
      linkedIds.length
        ? (
            await this.prisma.study.findMany({
              where: { id: { in: linkedIds } },
              select: { id: true, code: true },
            })
          ).map((s) => [s.id, s.code])
        : [],
    );

    const graph = new Map<string, string[]>();
    for (const [panelId, childIds] of linksById) {
      const panelCode = codeById.get(panelId);
      if (!panelCode) continue;
      graph.set(
        panelCode,
        childIds.flatMap((id) => codeById.get(id) ?? []),
      );
    }
    // The file replaces each panel's children.
    for (const row of panelRows) graph.set(row.code, row.panelCodes!);

    const cyclic = new Set(
      findPanelsInCycle(
        graph,
        panelRows.map((r) => r.code),
      ),
    );
    if (!cyclic.size) return;

    for (let i = valid.length - 1; i >= 0; i--) {
      if (!cyclic.has(valid[i].code)) continue;
      invalid.push({
        row: valid[i].row,
        code: valid[i].code,
        errors: [CYCLE_ERROR],
      });
      valid.splice(i, 1);
    }
    invalid.sort((a, b) => a.row - b.row);
  }

  async importPanelItems(
    branchId: string,
    panelRows: Array<{ code: string; panelCodes: string[] }>,
  ) {
    const panelErrors: Array<{ code: string; error: string }> = [];
    if (!panelRows.length) return { panelsUpdated: 0, panelErrors };

    const neededCodes = new Set(
      panelRows.flatMap((r) => [r.code, ...r.panelCodes]),
    );
    const studies = await this.prisma.study.findMany({
      where: { branchId, code: { in: [...neededCodes] } },
      select: { id: true, code: true, isActive: true },
    });
    const idByCode = new Map(studies.map((s) => [s.code, s.id]));
    const inactiveCodes = new Set(
      studies.filter((s) => !s.isActive).map((s) => s.code),
    );

    const graph = await loadPanelGraph(this.prisma, branchId);
    const pending = new Map<string, { code: string; childIds: string[] }>();

    for (const row of panelRows) {
      const missing = row.panelCodes.filter((c) => !idByCode.has(c));
      if (missing.length) {
        panelErrors.push({
          code: row.code,
          error: `Parámetros no encontrados en la sucursal: ${missing.join(', ')}`,
        });
        continue;
      }
      const inactive = row.panelCodes.filter((c) => inactiveCodes.has(c));
      if (inactive.length) {
        panelErrors.push({
          code: row.code,
          error: `Un perfil solo puede contener estudios activos: ${inactive.join(', ')}`,
        });
        continue;
      }
      const panelId = idByCode.get(row.code)!;
      const childIds = row.panelCodes.map((c) => idByCode.get(c)!);
      graph.set(panelId, childIds);
      pending.set(panelId, { code: row.code, childIds });
    }

    const cyclic = new Set(findPanelsInCycle(graph, pending.keys()));
    let panelsUpdated = 0;

    for (const [panelId, { code, childIds }] of pending) {
      // Already rejected by rejectCyclicPanels; kept in case the branch's
      // panels changed while the import ran.
      if (cyclic.has(panelId)) {
        panelErrors.push({ code, error: CYCLE_ERROR });
        continue;
      }

      try {
        await this.prisma.$transaction([
          this.prisma.studyPanelItem.deleteMany({ where: { panelId } }),
          this.prisma.studyPanelItem.createMany({
            data: childIds.map((childId, order) => ({
              panelId,
              childId,
              order,
            })),
          }),
        ]);
        panelsUpdated++;
      } catch (error) {
        panelErrors.push({ code, error: importErrorMessage(error) });
      }
    }

    return { panelsUpdated, panelErrors };
  }
}
