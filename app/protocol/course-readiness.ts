export interface CourseItemReadinessContext {
  documentMode: "proof" | "course-notes";
  currentStatementId: string;
  completedStatementIds: readonly string[];
  writtenStatementIds: readonly string[];
  roadmap: ReadonlyArray<{ statementId: string }>;
}

/**
 * Continue is a local course-state decision, not a tutor-model judgment.
 * A current outline item is ready only after its generated note entry exists.
 */
export function isCourseItemReadyToAdvance(
  context: CourseItemReadinessContext,
): boolean {
  if (context.documentMode !== "course-notes") return false;
  if (
    !context.roadmap.some(
      (item) => item.statementId === context.currentStatementId,
    )
  ) {
    return false;
  }
  if (context.completedStatementIds.includes(context.currentStatementId)) {
    return false;
  }
  return context.writtenStatementIds.includes(context.currentStatementId);
}
