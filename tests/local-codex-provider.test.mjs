import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

async function loadHarness() {
  const source = String.raw`
    import {
      LocalCodexProvider,
      buildInitializationPromptPreview,
    } from "./app/providers/local-codex.ts";
    import { euclidLesson } from "./app/lessons/euclid.ts";
    import {
      TUTOR_PROTOCOL_VERSION,
      TUTOR_RESPONSE_SCHEMA_JSON,
    } from "./app/protocol/index.ts";

    export function exerciseInitializationPreview() {
      const context = {
        profile: {
          name: "Imported proof guide",
          personality: "Careful, curious, and concise.",
          customPrompts: ["Ask for a reason before accepting a proof step."],
        },
        studentBackground: "The student knows divisibility but is new to contradiction.",
        curriculum: [
          {
            kind: "lemma",
            title: "Prime divisor lemma",
            statementLatex: "m>1\\implies\\exists q\\text{ prime with }q\\mid m",
          },
        ],
      };
      const first = buildInitializationPromptPreview(euclidLesson, context);
      const second = buildInitializationPromptPreview(euclidLesson, context);
      return {
        request: first.request,
        prompt: first.prompt,
        deterministic: first.request.requestId === second.request.requestId,
        containsFullSchema: first.prompt.includes(TUTOR_RESPONSE_SCHEMA_JSON),
      };
    }

    export async function exerciseNextSentenceLabels() {
      const completeSentence = "Let \\(N=p_1p_2\\cdots p_n+1.\\)";
      const provider = new LocalCodexProvider(async (request) => ({
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        requestId: request.requestId,
        classification: {
          type: "classify_student_intent",
          intent: "session_start",
          confidence: 1,
          rationale: "The student needs precise next-sentence choices.",
        },
        commands: [
          {
            type: "propose_next_sentences",
            prompt: "Choose the precise construction sentence.",
            choices: [
              {
                id: "complete-sentence",
                latex: completeSentence,
                explanation: "This is already prose with delimited inline mathematics.",
              },
              {
                id: "bare-expression",
                latex: "N\\equiv1\\pmod{p_i}",
                explanation: "A bare expression still needs inline delimiters.",
              },
            ],
          },
        ],
      }));
      const result = await provider.createSession(euclidLesson);
      return result.state.control?.pendingChoiceSet?.choices.map((choice) => choice.label);
    }

    export async function exerciseProofFeedback(replaceProof) {
      let feedbackRequest;
      const editedProof = [
        "\\begin{proof}",
        "Assume there are only finitely many primes. % Should this name the primes?",
        "The probability is 50\\% here.",
        "\\end{proof}",
      ].join("\n");
      const revisedProof = [
        "\\begin{proof}",
        "Assume for contradiction that the complete list of primes is \\(p_1,\\ldots,p_n\\).",
        "\\end{proof}",
      ].join("\n");
      const provider = new LocalCodexProvider(async (request) => {
        if (request.studentInput.kind === "session_start") {
          return {
            protocolVersion: TUTOR_PROTOCOL_VERSION,
            requestId: request.requestId,
            classification: {
              type: "classify_student_intent",
              intent: "session_start",
              confidence: 1,
              rationale: "The session is starting.",
            },
            commands: [{ type: "reply", markdown: "How would you begin?" }],
          };
        }
        feedbackRequest = request;
        return {
          protocolVersion: TUTOR_PROTOCOL_VERSION,
          requestId: request.requestId,
          classification: {
            type: "classify_student_intent",
            intent: "request_proof_feedback",
            confidence: 1,
            rationale: "The student requested feedback on a source edit.",
          },
          commands: replaceProof
            ? [
                {
                  type: "replace_latex",
                  latex: revisedProof,
                  reason: "The comment asks for the finite list to be named precisely.",
                },
                { type: "reply", markdown: "I made the requested assumption precise." },
              ]
            : [
                {
                  type: "reply",
                  markdown: "Name the complete list as \\(p_1,\\ldots,p_n\\); the edit remains in place.",
                },
              ],
        };
      });

      const started = await provider.createSession(euclidLesson);
      const previousLatex = started.state.proof.previewLatex;
      const rendered = await provider.dispatch(euclidLesson, started.state, {
        type: "render-proof",
        latex: editedProof,
      });
      const reviewed = await provider.dispatch(euclidLesson, rendered.state, {
        type: "request-proof-feedback",
        latex: editedProof,
      });

      return {
        request: feedbackRequest,
        previousLatex,
        editedProof,
        revisedProof,
        proof: reviewed.state.proof,
        reply: reviewed.state.messages.at(-1)?.markdown,
        accepted: reviewed.accepted,
      };
    }

    export async function exerciseProvider() {
      const requests = [];
      const prompts = [];
      const transport = async (request, prompt) => {
        requests.push(request);
        prompts.push(prompt);
        if (request.studentInput.kind === "session_start") {
          return {
            protocolVersion: TUTOR_PROTOCOL_VERSION,
            requestId: request.requestId,
            classification: {
              type: "classify_student_intent",
              intent: "session_start",
              confidence: 1,
              rationale: "The session is starting.",
            },
            commands: [
              { type: "reply", markdown: "How would you begin a contradiction proof?" },
              {
                type: "propose_approaches",
                prompt: "Choose an opening.",
                choices: [
                  {
                    id: "contradiction",
                    label: "Assume finitely many primes",
                    explanation: "Negate the theorem.",
                  },
                  {
                    id: "examples",
                    label: "List examples",
                    explanation: "Useful for exploration, but not a proof.",
                  },
                ],
              },
            ],
          };
        }
        return {
          protocolVersion: TUTOR_PROTOCOL_VERSION,
          requestId: request.requestId,
          classification: {
            type: "classify_student_intent",
            intent: "select_choice",
            confidence: 0.99,
            rationale: "The student selected a pinned approach.",
          },
          commands: [
            { type: "set_mode", mode: "proof", reason: "A proof strategy was selected." },
            {
              type: "commit_latex",
              label: "Contradiction assumption",
              latex: "Assume for contradiction that only finitely many primes exist.",
            },
            {
              type: "reply",
              markdown: "The contradiction assumption is now in the proof. What is the complete finite list?",
            },
          ],
        };
      };

      const provider = new LocalCodexProvider(transport);
      const started = await provider.createSession(euclidLesson);
      const chosen = await provider.dispatch(euclidLesson, started.state, {
        type: "choose",
        choiceId: "contradiction",
      });

      const invalidProvider = new LocalCodexProvider(async (request) => ({
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        requestId: request.requestId,
        classification: {
          type: "classify_student_intent",
          intent: "session_start",
          confidence: 1,
          rationale: "The session is starting.",
        },
        commands: [
          { type: "set_expression", name: "smile", latex: "x" },
        ],
      }));
      const rejected = await invalidProvider.createSession(euclidLesson);

      let failedRequest;
      const failingProvider = new LocalCodexProvider(async (request) => {
        failedRequest = request;
        throw new Error("codex_failed");
      });
      const failedTurn = await failingProvider.dispatch(euclidLesson, started.state, {
        type: "message",
        text: "Please retry this turn.",
      });

      return {
        started: {
          providerId: started.state.providerId,
          choiceKind: started.state.control?.pendingChoiceSet?.kind,
          choiceCount: started.state.control?.pendingChoiceSet?.choices.length,
          lastMessage: started.state.messages.at(-1)?.markdown,
        },
        chosen: {
          mode: chosen.state.mode,
          intent: chosen.state.control?.studentIntent,
          pendingChoiceSet: chosen.state.control?.pendingChoiceSet ?? null,
          proof: chosen.state.proof.previewLatex,
          studentEcho: chosen.state.messages.at(-2)?.role,
          tutorReply: chosen.state.messages.at(-1)?.markdown,
        },
        rejected: {
          accepted: rejected.accepted,
          errorKind: rejected.state.messages.at(-1)?.kind,
          proofChanged: rejected.state.proof.revision !== 0,
        },
        failedTurn: {
          accepted: failedTurn.accepted,
          errorCode: failedTurn.state.error?.code,
          errorMessage: failedTurn.state.messages.at(-1)?.markdown,
          studentEchoCount: failedTurn.state.messages.filter(
            (message) => message.markdown === "Please retry this turn.",
          ).length,
          requestInput: failedRequest?.studentInput.text,
          transcriptContainsTurn: failedRequest?.recentTranscript.some(
            (entry) => entry.content === "Please retry this turn.",
          ),
        },
        requests,
        prompts,
      };
    }
  `;

  const result = await build({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "local-codex-provider-harness.ts",
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

test("Personal Codex provider applies only validated tutor commands", async () => {
  const harness = await loadHarness();
  const result = await harness.exerciseProvider();

  assert.deepEqual(result.started, {
    providerId: "local-codex",
    choiceKind: "approach",
    choiceCount: 2,
    lastMessage: "How would you begin a contradiction proof?",
  });
  assert.equal(result.chosen.mode, "proof");
  assert.equal(result.chosen.intent, "choice_selection");
  assert.equal(result.chosen.pendingChoiceSet, null);
  assert.match(result.chosen.proof, /Assume for contradiction that only finitely many primes exist\./);
  assert.equal(result.chosen.studentEcho, "student");
  assert.equal(
    result.chosen.tutorReply,
    "The contradiction assumption is now in the proof. What is the complete finite list?",
  );

  assert.equal(result.requests.length, 2);
  assert.equal(result.requests[0].studentInput.kind, "session_start");
  assert.ok(result.requests[0].curriculum.length >= 1);
  assert.ok(result.requests[0].curriculum.some((item) => item.kind === "theorem"));
  assert.equal(result.requests[1].studentInput.kind, "choice");
  assert.equal(result.requests[1].studentInput.selectedChoiceId, "contradiction");
  assert.doesNotMatch(JSON.stringify(result.requests), /imageDataUrl|data:image/i);
  assert.match(result.prompts[0], /Return exactly one JSON object and nothing else/);

  assert.deepEqual(result.rejected, {
    accepted: false,
    errorKind: "error",
    proofChanged: false,
  });
  assert.deepEqual(result.failedTurn, {
    accepted: false,
    errorCode: "codex_failed",
    errorMessage:
      "Codex started but could not complete the tutor turn. Check the site terminal for the specific error, then try again.",
    studentEchoCount: 0,
    requestInput: "Please retry this turn.",
    transcriptContainsTurn: false,
  });
});

test("Personal Codex next-sentence labels preserve complete delimited prose", async () => {
  const harness = await loadHarness();
  const labels = await harness.exerciseNextSentenceLabels();

  assert.deepEqual(labels, [
    String.raw`Let \(N=p_1p_2\cdots p_n+1.\)`,
    String.raw`$N\equiv1\pmod{p_i}$`,
  ]);
});

test("proof feedback sends the edit delta and comments while preserving a reply-only edit", async () => {
  const harness = await loadHarness();
  const result = await harness.exerciseProofFeedback(false);

  assert.equal(result.accepted, true);
  assert.equal(result.request.studentInput.kind, "proof_feedback_request");
  assert.equal(result.request.currentProof.latex, result.editedProof);
  assert.equal(result.request.studentInput.proofEdit.previousLatex, result.previousLatex);
  assert.match(result.request.studentInput.proofEdit.changed, /Previous region:/);
  assert.match(result.request.studentInput.proofEdit.changed, /Current region:/);
  assert.deepEqual(result.request.studentInput.proofEdit.comments, [
    "Line 2: Should this name the primes?",
  ]);
  assert.equal(result.proof.editorLatex, result.editedProof);
  assert.equal(result.proof.previewLatex, result.editedProof);
  assert.equal(result.proof.reviewedLatex, result.editedProof);
  assert.match(result.reply, /Name the complete list/);
});

test("proof feedback lets Personal Codex replace the complete submitted proof", async () => {
  const harness = await loadHarness();
  const result = await harness.exerciseProofFeedback(true);

  assert.equal(result.accepted, true);
  assert.equal(result.proof.editorLatex, result.revisedProof);
  assert.equal(result.proof.previewLatex, result.revisedProof);
  assert.equal(result.proof.reviewedLatex, result.revisedProof);
  assert.equal(result.proof.revision, 2);
  assert.equal(result.reply, "I made the requested assumption precise.");
});

test("initialization preview is exact, deterministic, and image-free", async () => {
  const harness = await loadHarness();
  const preview = harness.exerciseInitializationPreview();

  assert.equal(preview.deterministic, true);
  assert.equal(preview.request.requestId, "initialization-preview-v1");
  assert.deepEqual(preview.request.studentInput, {
    kind: "session_start",
    text: "",
  });
  assert.deepEqual(preview.request.profile, {
    name: "Imported proof guide",
    personality: "Careful, curious, and concise.",
    customInstructions: ["Ask for a reason before accepting a proof step."],
  });
  assert.equal(
    preview.request.studentBackground,
    "The student knows divisibility but is new to contradiction.",
  );
  assert.deepEqual(preview.request.curriculum, [
    {
      kind: "lemma",
      title: "Prime divisor lemma",
      statementLatex: String.raw`m>1\implies\exists q\text{ prime with }q\mid m`,
    },
  ]);
  assert.deepEqual(preview.request.recentTranscript, []);
  assert.deepEqual(preview.request.pinnedChoices, []);
  assert.equal(preview.containsFullSchema, true);
  assert.match(preview.prompt, /"additionalProperties": false/);
  assert.doesNotMatch(
    JSON.stringify({ request: preview.request, prompt: preview.prompt }),
    /imageDataUrl|data:image/i,
  );
});
