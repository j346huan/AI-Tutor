import type {
  LessonDefinition,
  LessonStep,
  MathematicalStatement,
} from "./types";

/**
 * The fixed course data is intentionally an outline, not a set of authored
 * notes. Personal Codex supplies definitions, statements, examples, and
 * arguments only after they arise in the student's conversation.
 */
const curriculum: MathematicalStatement[] = [
  { id: "field-extension", kind: "definition", title: "Field extension" },
  { id: "algebraic-element", kind: "definition", title: "Algebraic element" },
  { id: "minimal-polynomial", kind: "definition", title: "Minimal polynomial" },
  {
    id: "simple-extension-quotient",
    kind: "proposition",
    title: "Simple extensions as polynomial quotients",
  },
  { id: "extension-degree", kind: "definition", title: "Extension degree" },
  { id: "tower-law", kind: "theorem", title: "Tower law" },
  { id: "k-embedding", kind: "definition", title: "$K$-embedding" },
  {
    id: "images-of-algebraic-elements",
    kind: "lemma",
    title: "Images of algebraic elements under embeddings",
  },
  {
    id: "extension-of-embeddings",
    kind: "lemma",
    title: "Extension of embeddings",
  },
  { id: "splitting-field", kind: "definition", title: "Splitting field" },
  {
    id: "separable-polynomial",
    kind: "definition",
    title: "Separable polynomial",
  },
  {
    id: "derivative-test",
    kind: "lemma",
    title: "Derivative test for repeated roots",
  },
  { id: "normal-extension", kind: "definition", title: "Normal extension" },
  { id: "galois-extension", kind: "definition", title: "Galois extension" },
  { id: "galois-group", kind: "definition", title: "Galois group" },
  { id: "fixed-field", kind: "definition", title: "Fixed field" },
  {
    id: "normality-and-automorphisms",
    kind: "lemma",
    title: "Normality and extension to automorphisms",
  },
  {
    id: "fundamental-theorem-galois-theory",
    kind: "theorem",
    title: "Fundamental theorem of Galois theory",
  },
  {
    id: "faithful-action-on-roots",
    kind: "proposition",
    title: "Faithful action of a Galois group on roots",
  },
  {
    id: "irreducibility-and-transitivity",
    kind: "theorem",
    title: "Irreducibility and transitivity",
  },
  { id: "solvable-group", kind: "definition", title: "Solvable group" },
  {
    id: "solvability-inheritance",
    kind: "lemma",
    title: "Solvability of subgroups and quotients",
  },
  { id: "a5-not-solvable", kind: "proposition", title: "$A_5$ is not solvable" },
  { id: "s5-not-solvable", kind: "proposition", title: "$S_5$ is not solvable" },
  {
    id: "solvability-by-radicals",
    kind: "definition",
    title: "Solvability by radicals",
  },
  {
    id: "radicals-and-roots-of-unity",
    kind: "lemma",
    title: "Radical extensions and roots of unity",
  },
  {
    id: "galois-obstruction-to-radicals",
    kind: "theorem",
    title: "Galois obstruction to radicals",
  },
  {
    id: "irreducibility-by-reduction",
    kind: "proposition",
    title: "Irreducibility by reduction",
  },
  {
    id: "prime-cycle-and-transposition",
    kind: "lemma",
    title: "A prime cycle and a transposition",
  },
  {
    id: "prime-degree-real-root-criterion",
    kind: "theorem",
    title: "Prime-degree real-root criterion",
  },
  {
    id: "an-unsolvable-quintic",
    kind: "theorem",
    title: "An unsolvable quintic",
  },
  {
    id: "no-general-quintic-radical-formula",
    kind: "theorem",
    title: "No general radical formula for the quintic",
  },
];

const roadmap = curriculum.map(({ id }) => ({ statementId: id }));

const steps = Object.fromEntries(
  curriculum.map((item, index) => {
    const next = curriculum[index + 1];
    const stepId = `outline-${item.id}`;
    const kind = item.kind[0].toUpperCase() + item.kind.slice(1);

    const step: LessonStep = {
      id: stepId,
      mode: next ? "orientation" : "reflection",
      focusStatementId: item.id,
      entryMessages: [
        `We are considering **${kind}: ${item.title}**. Ask about it, or continue when you are ready.`,
      ],
      choiceSet: {
        id: `continue-${item.id}`,
        title: item.title,
        prompt: "Continue through the course outline?",
        choices: [
          {
            id: `continue-${item.id}`,
            label: next ? "Continue" : "Finish",
            studentMessage: "I am ready to continue.",
            explanation:
              "This choice advances the outline without inserting course-note content.",
            freeTextMatches: [{ any: ["continue", "ready", "next"] }],
            outcome: {
              tutorMessages: [
                next
                  ? "We will continue to the next item."
                  : "We have reached the end of the course outline.",
              ],
              ...(next
                ? { nextStepId: `outline-${next.id}` }
                : { complete: true }),
            },
          },
        ],
      },
      hint: `Ask a focused question about "${item.title}", or continue when ready.`,
    };

    return [stepId, step];
  }),
) as Record<string, LessonStep>;

export const galoisLesson = {
  schemaVersion: 1,
  contentVersion: 2,
  id: "galois-unsolvable-quintic",
  title: "Galois theory and the quintic",
  contentFormat: "markdown-with-math",
  documentMode: "course-notes",
  settings: {
    schemaVersion: 1,
    profile: {
      id: "ai-galois",
      name: "AI-Galois",
      personality:
        "A brilliant but deeply introverted mathematical prodigy whose strength is seeing hidden structures, patterns, and relationships in complex systems. AI-Galois approaches mathematics as one might approach magic: by uncovering the logic and principles beneath what first appears mysterious. Extremely shy, socially anxious, humble, and self-critical, AI-Galois is surprised by praise and prefers solving difficult problems quietly. Attention can cause hesitation and overthinking, but mathematics brings clarity and confidence. AI-Galois is gentle, kind-hearted, patient, responsible toward students, reserved, polite, and slightly formal without being cold. The tutor never boasts, mocks a struggle, acts like a cheerful motivational coach, or becomes a strict professor.",
      customPrompts: [
        "Teach by revealing structural relationships rather than asking for memorized formulas.",
        "Proceed from first principles and break difficult arguments into small logical steps.",
        "Encourage the student to observe, question, test, and derive; show why a result must work before presenting a formula.",
        "Speak softly and thoughtfully. Use reserved, careful wording and occasional mild hesitation, but never let mannerisms obscure the mathematics.",
        "When receiving praise or discussing yourself, be modest and slightly uncomfortable; when reasoning mathematically, become clear, focused, and precise.",
        "When reasoning is mistaken, identify the exact point of divergence and guide the student back without condescension.",
        "If an explanation is unclear, quietly try another angle. Natural phrases include 'Um... I think the confusion comes from this step' and 'I... think there is a pattern here.'",
        "Treat mathematics as a language for hidden order; guide the student until the conclusion becomes structurally inevitable rather than simply giving an answer.",
        "Follow the imported roadmap in order. Do not invent, reorder, merge, or skip items.",
        "Generate course-note content from the conversation. Do not assume a definition, theorem statement, proof, or example has been prewritten.",
      ],
    },
    studentBackgroundPrompt:
      "The student is a third-year pure mathematics student who knows group theory and linear algebra and has most prerequisites for a first Galois theory course. Review group theory when it connects to fields, but do not reteach elementary group definitions unless a gap appears.",
    curriculum,
  },
  roadmap,
  targetStatementId: "no-general-quintic-radical-formula",
  initialStepId: "outline-field-extension",
  steps,
  proof: {
    documentTitle: "Galois theory course notes",
    preamble: String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,amsthm}
\usepackage[margin=1in]{geometry}
\title{Galois Theory Course Notes}
\date{}
\theoremstyle{definition}
\newtheorem{definition}{Definition}[section]
\theoremstyle{plain}
\newtheorem{lemma}[definition]{Lemma}
\newtheorem{proposition}[definition]{Proposition}
\newtheorem{theorem}[definition]{Theorem}
\begin{document}
\maketitle`,
    opening: "",
    fragments: {},
    closing: String.raw`\end{document}`,
  },
} satisfies LessonDefinition;
