import { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

export type PanelGraph = Map<string, string[]>;

const PANEL_CHILD_SELECT = {
  id: true,
  code: true,
  name: true,
  abbreviation: true,
  isPanel: true,
} satisfies Prisma.StudySelect;

type PanelChild = Prisma.StudyGetPayload<{
  select: typeof PANEL_CHILD_SELECT;
}>;

export type PanelTreeNode = PanelChild & {
  order: number;
  children: PanelTreeNode[];
};

export type PanelComponentSnapshot = {
  studyId: string;
  code: string;
  name: string;
  level: number;
};

export async function loadPanelGraph(
  db: Db,
  branchId: string,
): Promise<PanelGraph> {
  const links = await db.studyPanelItem.findMany({
    where: { panel: { branchId } },
    select: { panelId: true, childId: true },
    orderBy: { order: 'asc' },
  });

  const graph: PanelGraph = new Map();
  for (const { panelId, childId } of links) {
    const children = graph.get(panelId) ?? [];
    children.push(childId);
    graph.set(panelId, children);
  }
  return graph;
}

export function findPanelsInCycle(
  graph: PanelGraph,
  panelIds: Iterable<string>,
): string[] {
  const inCycle: string[] = [];

  for (const panelId of panelIds) {
    const visited = new Set<string>();
    const stack = [...(graph.get(panelId) ?? [])];

    while (stack.length) {
      const current = stack.pop()!;
      if (current === panelId) {
        inCycle.push(panelId);
        break;
      }
      if (visited.has(current)) continue;
      visited.add(current);
      stack.push(...(graph.get(current) ?? []));
    }
  }

  return inCycle;
}

async function loadChildrenByPanel(
  db: Db,
  rootIds: string[],
): Promise<Map<string, Array<PanelChild & { order: number }>>> {
  const childrenByPanel = new Map<
    string,
    Array<PanelChild & { order: number }>
  >();
  let frontier = [...new Set(rootIds)];

  while (frontier.length) {
    const links = await db.studyPanelItem.findMany({
      where: { panelId: { in: frontier } },
      select: {
        panelId: true,
        order: true,
        child: { select: PANEL_CHILD_SELECT },
      },
      orderBy: [{ order: 'asc' }, { child: { name: 'asc' } }],
    });

    for (const panelId of frontier) childrenByPanel.set(panelId, []);
    for (const { panelId, order, child } of links) {
      childrenByPanel.get(panelId)!.push({ ...child, order });
    }

    frontier = [
      ...new Set(
        links
          .filter(({ child }) => child.isPanel)
          .map(({ child }) => child.id)
          .filter((id) => !childrenByPanel.has(id)),
      ),
    ];
  }

  return childrenByPanel;
}

export async function loadPanelTree(
  db: Db,
  panelId: string,
): Promise<PanelTreeNode[]> {
  const childrenByPanel = await loadChildrenByPanel(db, [panelId]);

  const build = (id: string, path: Set<string>): PanelTreeNode[] =>
    (childrenByPanel.get(id) ?? []).map((child) => ({
      ...child,
      children:
        child.isPanel && !path.has(child.id)
          ? build(child.id, new Set(path).add(child.id))
          : [],
    }));

  return build(panelId, new Set([panelId]));
}

export async function loadPanelSnapshots(
  db: Db,
  panelIds: string[],
): Promise<Map<string, PanelComponentSnapshot[]>> {
  const childrenByPanel = await loadChildrenByPanel(db, panelIds);

  const flatten = (
    id: string,
    level: number,
    path: Set<string>,
  ): PanelComponentSnapshot[] =>
    (childrenByPanel.get(id) ?? []).flatMap((child) => [
      { studyId: child.id, code: child.code, name: child.name, level },
      ...(child.isPanel && !path.has(child.id)
        ? flatten(child.id, level + 1, new Set(path).add(child.id))
        : []),
    ]);

  return new Map(
    panelIds.map((id) => [id, flatten(id, 1, new Set([id]))] as const),
  );
}
