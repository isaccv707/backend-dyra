import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma/prisma.service';
import { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { PANEL_ITEMS_INCLUDE } from '../constants/study-includes.const';
import { SetPanelItemsDto } from '../dto/set-panel-items.dto';
import { StudyDb } from '../types/study-db.type';
import {
  findPanelsInCycle,
  loadPanelGraph,
  loadPanelTree,
} from '../utils/panel-tree.util';
import {
  handleStudyDbErrors,
  studyNotFound,
} from '../utils/study-mappers.util';
import { studyTitle } from '../utils/study-title.util';
import { StudyValidationService } from './study-validation.service';

/** Panel (profile) tree and its children. */
@Injectable()
export class StudyPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: StudyValidationService,
  ) {}

  async getPanelTree(id: string) {
    const study = await this.prisma.study.findFirst({
      where: { id, isActive: true },
      select: { id: true, code: true, name: true, title: true, isPanel: true },
    });
    if (!study) throw studyNotFound(id);

    return {
      ...study,
      title: studyTitle(study),
      children: study.isPanel ? await loadPanelTree(this.prisma, study.id) : [],
    };
  }

  /**
   * Children rules of a panel (except cycles, checked when saving). `panelId`
   * is null for a panel that doesn't exist yet.
   */
  async assertValidPanelChildren(
    panelId: string | null,
    branchId: string,
    childIds: string[],
    db: StudyDb = this.prisma,
  ) {
    if (new Set(childIds).size !== childIds.length) {
      throw new BadRequestException('El perfil contiene estudios repetidos');
    }
    if (panelId && childIds.includes(panelId)) {
      throw new BadRequestException('Un perfil no puede contenerse a sí mismo');
    }

    const children = await db.study.findMany({
      where: { id: { in: childIds } },
      select: { id: true, code: true, branchId: true, isActive: true },
    });
    if (
      children.length !== childIds.length ||
      children.some((c) => c.branchId !== branchId)
    ) {
      throw new BadRequestException(
        'Todos los estudios del perfil deben existir y pertenecer a la misma sucursal del perfil',
      );
    }
    const inactiveChildren = children.filter((c) => !c.isActive);
    if (inactiveChildren.length) {
      throw new BadRequestException(
        `Un perfil solo puede contener estudios activos: ${inactiveChildren
          .map((c) => c.code)
          .join(', ')}`,
      );
    }
  }

  /** With `tx`, runs inside the caller's transaction instead of its own. */
  async setPanelItems(
    id: string,
    dto: SetPanelItemsDto,
    user: BranchScopedUser,
    tx?: StudyDb,
  ) {
    const db = tx ?? this.prisma;
    const panel = await this.validation.findAccessibleStudy(id, user, db);
    if (!panel.isPanel) {
      throw new BadRequestException(
        'Solo un estudio marcado como perfil (isPanel) puede tener estudios hijos',
      );
    }

    const childIds = dto.items.map((item) => item.childId);
    await this.assertValidPanelChildren(id, panel.branchId, childIds, db);

    const replaceItems = async (client: StudyDb) => {
      const graph = await loadPanelGraph(client, panel.branchId);
      graph.set(id, childIds);
      if (findPanelsInCycle(graph, [id]).length) {
        throw new BadRequestException(
          'La lista crea un ciclo: algún perfil hijo ya contiene (directa o indirectamente) a este perfil',
        );
      }

      await client.studyPanelItem.deleteMany({ where: { panelId: id } });
      await client.studyPanelItem.createMany({
        data: dto.items.map((item, index) => ({
          panelId: id,
          childId: item.childId,
          order: item.order ?? index,
        })),
      });
    };

    try {
      await (tx ? replaceItems(tx) : this.prisma.$transaction(replaceItems));
    } catch (error) {
      handleStudyDbErrors(error);
    }

    return db.studyPanelItem.findMany({
      where: { panelId: id },
      ...PANEL_ITEMS_INCLUDE,
    });
  }
}
