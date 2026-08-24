import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

async function loadHarness() {
  const source = String.raw`
    import { euclidLesson } from "./app/lessons/euclid.ts";
    import { galoisLesson } from "./app/lessons/galois.ts";
    import { buildInitializationPromptPreview } from "./app/providers/local-codex.ts";
    import {
      TUTOR_PROTOCOL_VERSION,
      buildTutorPrompt,
      parseTutorResponse,
    } from "./app/protocol/index.ts";

    const preview = buildInitializationPromptPreview(euclidLesson);
    const galoisPreview = buildInitializationPromptPreview(galoisLesson);

    function request(overrides = {}) {
      return {
        ...preview.request,
        requestId: "policy-turn",
        studentInput: {
          kind: "message",
          text: "Let $N=p_1p_2\\cdots p_n+1$.",
        },
        ...overrides,
      };
    }

    function response(intent, commands) {
      return {
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        requestId: "policy-turn",
        classification: {
          type: "classify_student_intent",
          intent,
          confidence: 1,
          rationale: "Deterministic policy fixture.",
        },
        commands,
      };
    }

    export function exercisePolicy() {
      const proofRequest = request();
      const committed = parseTutorResponse(
        response("proof_step", [
          {
            type: "commit_latex",
            label: "Define the auxiliary number",
            latex: "Let \\(N=p_1p_2\\cdots p_n+1\\).",
          },
          {
            type: "reply",
            markdown: "The definition is now in the proof. What remainder does division by $p_i$ leave?",
          },
        ]),
        proofRequest,
      );
      const affirmedWithoutCommit = parseTutorResponse(
        response("proof_step", [
          { type: "reply", markdown: "That definition works. What follows?" },
        ]),
        proofRequest,
      );
      const gap = parseTutorResponse(
        response("proof_step", [
          {
            type: "identify_mistake",
            severity: "logical_gap",
            message: "The claimed divisibility has not been justified.",
            suggestion: "What is the remainder modulo $p_i$?",
          },
        ]),
        proofRequest,
      );
      const vague = parseTutorResponse(
        response("proof_step", [
          {
            type: "propose_next_sentences",
            prompt: "Choose the precise claim you intended.",
            choices: [
              {
                id: "remainder",
                latex: "N\\equiv 1\\pmod{p_i}",
                explanation: "State the remainder explicitly.",
              },
              {
                id: "not-divides",
                latex: "p_i\\nmid N",
                explanation: "State the divisibility conclusion.",
              },
            ],
          },
        ]),
        proofRequest,
      );
      const genericPraise = parseTutorResponse(
        response("mathematical_question", [
          { type: "reply", markdown: "Good. The remainder is $1$." },
        ]),
      );
      const tooManySentences = parseTutorResponse(
        response("mathematical_question", [
          { type: "reply", markdown: "First sentence. Second sentence. Third sentence. Fourth sentence." },
        ]),
      );
      const tooManyQuestions = parseTutorResponse(
        response("mathematical_question", [
          { type: "reply", markdown: "What is the remainder? What does it imply?" },
        ]),
      );
      const mathematicalOpening = parseTutorResponse(
        response("mathematical_question", [
          {
            type: "reply",
            markdown: "Exactly one remainder matters, e.g. modulo \\(p_i\\). The decimal 2.5 does not add a sentence. What is that remainder?",
          },
        ]),
      );
      const hiddenQuestionMarks = parseTutorResponse(
        response("mathematical_question", [
          {
            type: "reply",
            markdown:
              "Inspect $x?y$, " +
              String.fromCharCode(96) +
              "flag?" +
              String.fromCharCode(96) +
              ", and [this note](https://example.test/?q=1). What follows?",
          },
        ]),
      );
      const substantiveOpenings = [
        "Exactly when the remainder is zero does divisibility hold.",
        "Perfect squares have even prime exponents.",
        "Good reduction modulo $p_i$ preserves this relation.",
      ].map((markdown) =>
        parseTutorResponse(
          response("mathematical_question", [{ type: "reply", markdown }]),
        ),
      );
      const doubleTranscript = parseTutorResponse(
        response("mathematical_question", [
          {
            type: "identify_mistake",
            severity: "imprecision",
            message: "The index has not been quantified.",
            suggestion: "Specify that $1\\le i\\le n$.",
          },
          { type: "reply", markdown: "Which indices do you mean?" },
        ]),
      );
      const overBudgetTranscript = parseTutorResponse(
        response("mathematical_question", [
          {
            type: "identify_mistake",
            severity: "imprecision",
            message: "M".repeat(350),
            suggestion: "S".repeat(251),
          },
        ]),
      );
      const overBudgetChoices = parseTutorResponse(
        response("proposed_approach", [
          {
            type: "propose_approaches",
            prompt: "P".repeat(151),
            choices: [
              {
                id: "first",
                label: "L".repeat(100),
                explanation: "E".repeat(100),
              },
              {
                id: "second",
                label: "Q".repeat(100),
                explanation: "R".repeat(150),
              },
            ],
          },
        ]),
      );

      const nextSentenceRequest = request({
        studentInput: {
          kind: "choice",
          text: "State the definition.",
          selectedChoiceId: "define-n",
        },
        pinnedChoices: [
          {
            id: "define-n",
            kind: "next_sentence",
            label: "Define $N$",
          },
        ],
      });
      const selectedWithoutCommit = parseTutorResponse(
        response("select_choice", [
          { type: "reply", markdown: "This sentence defines the auxiliary number." },
        ]),
        nextSentenceRequest,
      );
      const questionAboutChoice = parseTutorResponse(
        response("question_about_choice", [
          { type: "reply", markdown: "The added $1$ creates a nonzero remainder modulo each listed prime." },
        ]),
        request({
          studentInput: {
            kind: "message",
            text: "Why add one?",
            selectedChoiceId: "define-n",
          },
          pinnedChoices: [
            {
              id: "define-n",
              kind: "next_sentence",
              label: "Define $N$",
            },
          ],
        }),
      );

      const prompt = buildTutorPrompt(proofRequest);
      const answerPrompt = buildTutorPrompt(
        request({
          recentTranscript: [
            {
              role: "tutor",
              content: "What condition should the polynomial satisfy?",
            },
          ],
          studentInput: {
            kind: "message",
            text: "It is a zero of a polynomial over K.",
          },
        }),
      );
      const directDefinitionPrompt = buildTutorPrompt(
        request({
          studentInput: {
            kind: "message",
            text: "What is an algebraic element? Please just state the definition.",
          },
        }),
      );
      const acknowledgementPrompt = buildTutorPrompt({
        ...galoisPreview.request,
        requestId: "policy-turn",
        recentTranscript: [
          {
            role: "tutor",
            content: "$\\mathbb Q\\subseteq\\mathbb C$ gives the basic relation behind a field extension.",
          },
        ],
        studentInput: {
          kind: "message",
          text: "ok?",
        },
      });
      const definitionExamplePrompt = buildTutorPrompt({
        ...galoisPreview.request,
        requestId: "policy-turn",
        studentInput: {
          kind: "message",
          text: "Could you give me an example?",
        },
      });
      const sessionStartPrompt = buildTutorPrompt(
        request({
          studentInput: {
            kind: "session_start",
            text: "",
          },
        }),
      );
      return {
        committed,
        affirmedWithoutCommit,
        gap,
        vague,
        genericPraise,
        tooManySentences,
        tooManyQuestions,
        mathematicalOpening,
        hiddenQuestionMarks,
        substantiveOpenings,
        doubleTranscript,
        overBudgetTranscript,
        overBudgetChoices,
        selectedWithoutCommit,
        questionAboutChoice,
        prompt,
        answerPrompt,
        directDefinitionPrompt,
        acknowledgementPrompt,
        definitionExamplePrompt,
        sessionStartPrompt,
      };
    }
  `;

  const result = await build({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "tutor-response-policy-harness.ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    write: false,
    logLevel: "silent",
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
}

test("accepted proof steps commit while gaps and clarification remain non-mutating", async () => {
  const { exercisePolicy } = await loadHarness();
  const result = exercisePolicy();

  assert.equal(result.committed.ok, true);
  assert.equal(result.gap.ok, true);
  assert.equal(result.vague.ok, true);
  assert.equal(result.affirmedWithoutCommit.ok, false);
  assert.equal(result.affirmedWithoutCommit.error.code, "invalid_response");
  assert.match(
    result.affirmedWithoutCommit.error.issues[0].message,
    /commit the accepted step/i,
  );
  assert.equal(result.selectedWithoutCommit.ok, false);
  assert.match(
    result.selectedWithoutCommit.error.issues[0].message,
    /proposed proof sentence/i,
  );
  assert.equal(result.questionAboutChoice.ok, true);
});

test("reply style is prompt-directed while transcript safety limits remain enforced", async () => {
  const { exercisePolicy } = await loadHarness();
  const result = exercisePolicy();

  assert.equal(result.genericPraise.ok, true);
  assert.equal(result.tooManySentences.ok, true);
  assert.equal(result.tooManyQuestions.ok, true);
  assert.equal(result.mathematicalOpening.ok, true);
  assert.equal(result.hiddenQuestionMarks.ok, true);
  assert.ok(result.substantiveOpenings.every((entry) => entry.ok));
  assert.equal(result.doubleTranscript.ok, false);
  assert.match(
    result.doubleTranscript.error.issues.find((issue) =>
      /transcript-producing/.test(issue.message),
    ).message,
    /only one/i,
  );
  assert.equal(result.overBudgetTranscript.ok, false);
  assert.equal(result.overBudgetChoices.ok, false);
  assert.match(
    result.overBudgetChoices.error.issues[0].message,
    /visible tutor copy/i,
  );
  assert.match(result.prompt, /one to three short sentences/i);
  assert.match(result.prompt, /at most one focused question/i);
  assert.match(result.prompt, /A reply may contain no question/i);
  assert.match(result.prompt, /Do not ask a question merely to keep the conversation going/i);
  assert.match(result.prompt, /commit or write any established mathematics before asking another/i);
  assert.match(result.prompt, /Accept mathematically correct paraphrases/i);
  assert.match(result.prompt, /never ask the student to repeat the tutor's wording/i);
  assert.match(result.prompt, /Student-facing copy is never a changelog/i);
  assert.match(result.prompt, /Never say that you "recorded," "added," "wrote," or "updated"/i);
  assert.match(result.prompt, /A roadmap transition must have mathematical purpose/i);
  assert.match(result.prompt, /not a bare request to recite an unfamiliar definition/i);
  assert.doesNotMatch(result.prompt, /propose_learning_actions/i);
  assert.doesNotMatch(result.prompt, /explore_example|check_understanding/i);
  assert.match(result.prompt, /site exposes Continue only when.*ready/i);
  assert.match(result.prompt, /never describe the interface state change itself/i);
  assert.match(result.prompt, /Course-note definitions are not proofs/i);
  assert.match(result.prompt, /after one substantive student exchange/i);
  assert.match(result.prompt, /one grammatical sentence without equivalent restatements/i);
  assert.match(result.prompt, /at most one transcript-producing command/i);
  assert.match(result.prompt, /600 characters total/i);
  assert.match(result.prompt, /must include commit_latex in this same response/i);
  assert.match(result.prompt, /never affirm it only in prose/i);
});

test("turn guidance stops back-to-back questions and answers direct definition requests", async () => {
  const { exercisePolicy } = await loadHarness();
  const result = exercisePolicy();

  assert.match(result.answerPrompt, /TURN QUESTION GUIDANCE/);
  assert.match(result.answerPrompt, /Do not ask another question this turn/i);
  assert.match(result.answerPrompt, /supply minor standard precision yourself/i);
  assert.match(result.directDefinitionPrompt, /TURN QUESTION GUIDANCE/);
  assert.match(result.directDefinitionPrompt, /do not append a recall question/i);
  assert.match(result.directDefinitionPrompt, /one-sentence entry/i);
  assert.match(result.directDefinitionPrompt, /do not advance the roadmap/i);
  assert.match(result.directDefinitionPrompt, /Do not narrate the write/i);
  assert.match(result.acknowledgementPrompt, /TURN DEFINITION-UNDERSTANDING GUIDANCE/);
  assert.match(result.acknowledgementPrompt, /does not demonstrate the key concept/i);
  assert.match(result.acknowledgementPrompt, /Do not state, restate, or write the definition/i);
  assert.match(result.acknowledgementPrompt, /Ask exactly one concise application or distinction question/i);
  assert.match(result.definitionExamplePrompt, /TURN DEFINITION-UNDERSTANDING GUIDANCE/);
  assert.match(result.definitionExamplePrompt, /Give one concise example without stating or writing/i);
  assert.match(result.definitionExamplePrompt, /ask exactly one focused application or distinction question/i);
  assert.match(result.definitionExamplePrompt, /acknowledgement alone must not unlock the definition/i);
  assert.doesNotMatch(result.sessionStartPrompt, /TURN QUESTION GUIDANCE/);
  assert.match(result.prompt, /one grammatical sentence/i);
  assert.match(result.prompt, /instead of adding a separate setup sentence/i);
  assert.match(result.prompt, /never make a course-note definition turn consist only of stating or restating the formal definition/i);
  assert.match(result.prompt, /example, non-example, or contrast/i);
  assert.match(result.prompt, /student's next substantive answer demonstrates that relation/i);
});
