export interface CpmNodeInput {
  id: string;
  duration: number;
}

export interface CpmEdgeInput {
  predecessorId: string;
  successorId: string;
}

export interface CpmValues {
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  slackDays: number;
  isCritical: boolean;
}

export interface CpmCalculation {
  values: Map<string, CpmValues>;
  projectDurationDays: number;
  criticalPaths: string[][];
}

export class CpmCycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super("The submitted dependencies contain a circular path.");
  }
}

export function calculateCpm(nodes: CpmNodeInput[], edges: CpmEdgeInput[]): CpmCalculation {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const predecessors = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const successors = new Map(nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of edges) {
    predecessors.get(edge.successorId)!.push(edge.predecessorId);
    successors.get(edge.predecessorId)!.push(edge.successorId);
  }

  const state = new Map<string, number>();
  const stack: string[] = [];
  const order: string[] = [];
  const visit = (id: string): void => {
    state.set(id, 1);
    stack.push(id);
    for (const successorId of successors.get(id)!) {
      if (!state.has(successorId)) visit(successorId);
      else if (state.get(successorId) === 1) {
        const start = stack.indexOf(successorId);
        throw new CpmCycleError([...stack.slice(start), successorId]);
      }
    }
    stack.pop();
    state.set(id, 2);
    order.push(id);
  };
  for (const node of nodes) if (!state.has(node.id)) visit(node.id);
  order.reverse();

  const values = new Map<string, CpmValues>();
  for (const id of order) {
    const earlyStart = Math.max(1, ...predecessors.get(id)!.map((pred) => values.get(pred)!.earlyFinish + 1));
    const earlyFinish = earlyStart + nodeById.get(id)!.duration - 1;
    values.set(id, { earlyStart, earlyFinish, lateStart: 0, lateFinish: 0, slackDays: 0, isCritical: false });
  }

  const projectDurationDays = Math.max(0, ...Array.from(values.values(), (value) => value.earlyFinish));
  for (const id of [...order].reverse()) {
    const successorIds = successors.get(id)!;
    const lateFinish = successorIds.length
      ? Math.min(...successorIds.map((successorId) => values.get(successorId)!.lateStart - 1))
      : projectDurationDays;
    const value = values.get(id)!;
    value.lateFinish = lateFinish;
    value.lateStart = lateFinish - nodeById.get(id)!.duration + 1;
    value.slackDays = value.lateStart - value.earlyStart;
    value.isCritical = value.slackDays === 0;
  }

  const criticalSuccessors = (id: string) => successors.get(id)!.filter((next) => {
    const currentValue = values.get(id)!;
    const nextValue = values.get(next)!;
    return currentValue.isCritical && nextValue.isCritical && nextValue.earlyStart === currentValue.earlyFinish + 1;
  });
  const criticalStarts = order.filter((id) => values.get(id)!.isCritical &&
    !predecessors.get(id)!.some((pred) => values.get(pred)!.isCritical && values.get(id)!.earlyStart === values.get(pred)!.earlyFinish + 1));
  const criticalPaths: string[][] = [];
  const walk = (id: string, path: string[]): void => {
    const next = criticalSuccessors(id);
    if (!next.length) {
      if (values.get(id)!.earlyFinish === projectDurationDays) criticalPaths.push([...path, id]);
      return;
    }
    for (const successorId of next) walk(successorId, [...path, id]);
  };
  for (const id of criticalStarts) walk(id, []);

  return { values, projectDurationDays, criticalPaths };
}
