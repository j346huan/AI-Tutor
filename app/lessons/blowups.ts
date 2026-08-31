import type {
  LessonDefinition,
  LessonStep,
  MathematicalStatement,
} from "./types";

/**
 * An outline-only course for a student who already knows varieties and schemes.
 * Personal Codex develops the statements, examples, and proofs through dialogue.
 */
const curriculum: MathematicalStatement[] = [
  { id: "rees-algebra", kind: "definition", title: "Rees algebra" },
  {
    id: "blow-up-closed-subscheme",
    kind: "definition",
    title: "Blow-up along a closed subscheme",
  },
  {
    id: "affine-equations-generators",
    kind: "proposition",
    title: "Affine equations from generators of the center ideal",
  },
  {
    id: "affine-plane-origin",
    kind: "proposition",
    title: String.raw`Blow-up of $\mathbb A^2$ at the origin`,
  },
  {
    id: "isomorphism-away-center",
    kind: "proposition",
    title: "The blow-up is an isomorphism away from its center",
  },
  { id: "exceptional-divisor", kind: "definition", title: "Exceptional divisor" },
  {
    id: "exceptional-curve-affine-plane",
    kind: "proposition",
    title: String.raw`The exceptional curve in the blow-up of $\mathbb A^2$`,
  },
  {
    id: "invertible-center-ideal",
    kind: "proposition",
    title: "Invertibility of the transformed center ideal",
  },
  {
    id: "universal-property",
    kind: "theorem",
    title: "Universal property of the blow-up",
  },
  {
    id: "cartier-center-trivial",
    kind: "proposition",
    title: "Blowing up an effective Cartier divisor is trivial",
  },
  {
    id: "total-strict-transform",
    kind: "definition",
    title: "Total transform and strict transform",
  },
  {
    id: "strict-transform-charts",
    kind: "proposition",
    title: "Affine chart equations for strict transforms",
  },
  {
    id: "flat-base-change",
    kind: "theorem",
    title: "Blow-ups and flat base change",
  },
  {
    id: "projectivity",
    kind: "proposition",
    title: "Projectivity of the blow-up morphism",
  },
  { id: "normal-cone", kind: "definition", title: "Normal cone" },
  {
    id: "exceptional-projectivized-normal-cone",
    kind: "theorem",
    title: "The exceptional divisor as the projectivized normal cone",
  },
  {
    id: "regular-center-normal-bundle",
    kind: "proposition",
    title: "Regular centers and the projectivized normal bundle",
  },
  {
    id: "normal-bundle-exceptional-divisor",
    kind: "proposition",
    title: "Normal bundle of the exceptional divisor",
  },
  {
    id: "smoothness-smooth-center",
    kind: "theorem",
    title: "Smoothness of a blow-up along a smooth center",
  },
  {
    id: "canonical-divisor-formula",
    kind: "theorem",
    title: "Canonical divisor formula for a smooth center",
  },
  {
    id: "picard-group-surface-blowup",
    kind: "proposition",
    title: "Picard group of the blow-up of a smooth surface at a point",
  },
  {
    id: "intersection-pairing-surface",
    kind: "theorem",
    title: "Intersection pairing after blowing up a smooth surface",
  },
  {
    id: "multiplicity-strict-transform",
    kind: "proposition",
    title: "Multiplicity and the class of a strict transform",
  },
  {
    id: "tangent-cone-exceptional-divisor",
    kind: "proposition",
    title: "The tangent cone on the exceptional divisor",
  },
  { id: "infinitely-near-point", kind: "definition", title: "Infinitely near point" },
  {
    id: "plane-curve-resolution",
    kind: "theorem",
    title: "Resolution of plane curve singularities by point blow-ups",
  },
  {
    id: "projective-plane-points",
    kind: "proposition",
    title: String.raw`Blow-ups of $\mathbb P^2$ at finitely many points`,
  },
  {
    id: "quadratic-cremona",
    kind: "theorem",
    title: "Resolution of the quadratic Cremona transformation",
  },
  { id: "divisorial-valuation", kind: "definition", title: "Divisorial valuation" },
  {
    id: "factorization-birational-morphisms-surfaces",
    kind: "theorem",
    title: "Factorization of birational morphisms between smooth surfaces",
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
        `We are considering **${kind}: ${item.title}**. Ask about the geometry, the scheme-theoretic construction, or a local calculation.`,
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
            explanation: "This advances to the next item in the blow-ups course.",
            freeTextMatches: [{ any: ["continue", "ready", "next"] }],
            outcome: {
              tutorMessages: [
                next
                  ? "We will use this result in the next part of the course."
                  : "We have reached the end of the course outline.",
              ],
              ...(next
                ? { nextStepId: `outline-${next.id}` }
                : { complete: true }),
            },
          },
        ],
      },
      hint: `Ask for a local model, a geometric interpretation, or a proof of "${item.title}".`,
    };
    return [stepId, step];
  }),
) as Record<string, LessonStep>;

export const blowupsLesson = {
  schemaVersion: 1,
  contentVersion: 1,
  id: "blow-ups-algebraic-geometry",
  title: "Blow-ups in algebraic geometry",
  contentFormat: "markdown-with-math",
  documentMode: "course-notes",
  settings: {
    schemaVersion: 1,
    profile: {
      id: "ai-birational-geometer",
      name: "The Birational Geometer",
      personality:
        "Precise, geometrically minded, and quietly demanding. The tutor treats blow-ups simultaneously as explicit local constructions, relative Proj constructions, and birational transformations. It assumes mathematical maturity, states hypotheses carefully, and uses computations to expose the geometry rather than as ends in themselves.",
      customPrompts: [
        "Assume the student is a master's student who already knows classical algebraic geometry, varieties, schemes, sheaves, divisors, and basic projective geometry.",
        "Do not reteach elementary scheme theory unless a genuine gap appears; connect new ideas directly to ideal sheaves, relative Proj, divisors, and birational maps.",
        "Use the blow-up of the affine plane at the origin as a running local model, but always explain which features persist for general schemes and centers.",
        "Move deliberately among the Rees algebra, affine charts, the universal property, and the geometric replacement of the center by limiting directions.",
        "State all hypotheses, especially regularity, smoothness, codimension, properness, and assumptions on the base field.",
        "Make the student compute charts, transition maps, exceptional divisors, strict transforms, divisor classes, and intersection numbers at strategically chosen points.",
        "Distinguish the exceptional divisor, total transform, strict transform, normal cone, and projectivized normal bundle with exceptional care.",
        "For theorem-like items, first isolate the precise statement, then develop a proof whose local algebra and global geometry illuminate each other.",
        "Follow the imported roadmap in order. Do not invent, reorder, merge, or skip items.",
        "Generate course-note content from the conversation; do not assume that definitions, statements, proofs, or examples have already been written.",
      ],
    },
    studentBackgroundPrompt:
      "The student is a master's student who knows classical algebraic geometry and is comfortable with varieties and schemes. The student knows affine and projective schemes, quasi-coherent ideal sheaves, morphisms, divisors, line bundles, smoothness, tangent spaces, and basic intersection theory, but has not systematically studied blow-ups. Begin with the Rees algebra and relative Proj while supplying immediate geometric intuition from the blow-up of the affine plane at the origin. Emphasize universal properties, exceptional geometry, strict transforms, and applications to smooth surfaces and resolution of plane curve singularities.",
    curriculum,
  },
  roadmap,
  targetStatementId: "factorization-birational-morphisms-surfaces",
  initialStepId: "outline-rees-algebra",
  steps,
  proof: {
    documentTitle: "Blow-ups in algebraic geometry course notes",
    preamble: String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,amsthm}
\usepackage[margin=1in]{geometry}
\title{Blow-ups in Algebraic Geometry}
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
