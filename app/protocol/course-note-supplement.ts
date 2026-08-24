export type CourseNoteSupplementKind = "lemma" | "proposition" | "theorem";

const SUPPLEMENT_KINDS: readonly CourseNoteSupplementKind[] = [
  "lemma",
  "proposition",
  "theorem",
];

/**
 * Finds theorem-like kinds that the student explicitly asked to add as a new
 * supplementary note. Merely mentioning an existing lemma is intentionally
 * insufficient: the request must contain insertion or transformation wording.
 */
export function requestedCourseNoteSupplementKinds(
  text: string,
): CourseNoteSupplementKind[] {
  const found = new Set<CourseNoteSupplementKind>();
  for (const kind of SUPPLEMENT_KINDS) {
    const directInsertion = new RegExp(
      String.raw`\b(?:add|insert|include)\s+(?:(?:this|that|it|the\s+(?:result|claim|argument|statement|fact|observation|material))\s+)?(?:as\s+)?(?:an?\s+|the\s+)?${kind}\b`,
      "i",
    );
    const insertionAsKind = new RegExp(
      String.raw`\b(?:add|insert|include|put|place)\b[^.!?\n]{0,80}\b(?:as|into)\s+(?:an?\s+|the\s+)?${kind}\b`,
      "i",
    );
    const transformIntoKind = new RegExp(
      String.raw`\b(?:make|turn)\s+(?:this|that|it|(?:this|that|the)\s+(?:proof|result|claim|argument|statement|fact|observation|material))\s+(?:into\s+)?(?:an?\s+|the\s+)?${kind}\b`,
      "i",
    );
    if (
      directInsertion.test(text) ||
      insertionAsKind.test(text) ||
      transformIntoKind.test(text)
    ) {
      found.add(kind);
    }
  }
  return [...found];
}
