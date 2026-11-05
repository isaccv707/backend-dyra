import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { findPanelsInCycle, loadPanelGraph } from '../utils/panel-tree.util';
import { importErrorMessage } from '../utils/study-import-error.util';

/** Replaces the children of the imported panels (column `parametros`). */
@Injectable()
export class StudyImportPanelsService {
  constructor(private readonly prisma: PrismaService) {}

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
      if (cyclic.has(panelId)) {
        panelErrors.push({
          code,
          error:
            'Los parámetros forman un ciclo: algún perfil hijo contiene (directa o indirectamente) a este perfil',
        });
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
