export interface DependencyInput {
  predecessorSubtaskId: string;
  successorSubtaskId: string;
}

export class CpmHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
