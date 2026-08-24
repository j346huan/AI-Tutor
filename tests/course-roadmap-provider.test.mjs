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
      isRestorableLocalCodexSession,
    } from "./app/providers/local-codex.ts";
    import {
      TUTOR_PROTOCOL_VERSION,
      buildCourseNoteEntry,
      parseTutorResponse,
      validateCourseNoteLatex,
    } from "./app/protocol/index.ts";
    import { parseDocumentBlocks } from "./app/components/ProofDocument.tsx";

    const LEGACY_SENTINEL = "LEGACY_PREWRITTEN_CONTENT_MUST_NOT_REACH_CODEX";
    const generatedBody = [
      "A \\emph{field extension} is an inclusion of fields $F\\subseteq K$ for which the operations on $F$ are the restrictions of those on $K$.",
      "Thus $K$ is naturally an $F$-vector space.",
    ].join("\\n\\n");

    const lesson = {
      schemaVersion: 1,
      contentVersion: 2,
      id: "course-test",
      title: "Generated course test",
      contentFormat: "markdown-with-math",
      documentMode: "course-notes",
      settings: {
        schemaVersion: 1,
        profile: {
          id: "course-guide",
          name: "Course guide",
          personality: "Quiet and precise.",
          customPrompts: ["Develop one outline item at a time."],
        },
        studentBackgroundPrompt: "The student knows groups and linear algebra.",
        curriculum: [
          {
            id: "field-extension",
            kind: "definition",
            title: "Field extension",
            statement: LEGACY_SENTINEL,
            latex: LEGACY_SENTINEL,
          },
          { id: "degree", kind: "definition", title: "Extension degree" },
          { id: "tower-law", kind: "theorem", title: "Tower law" },
        ],
      },
      targetStatementId: "tower-law",
      roadmap: [
        {
          statementId: "field-extension",
          teachingPrompt: LEGACY_SENTINEL,
          completionCriteria: [LEGACY_SENTINEL],
          noteFragmentIds: ["legacy-note"],
        },
        { statementId: "degree" },
        { statementId: "tower-law" },
      ],
      initialStepId: "course-start",
      steps: {
        "course-start": {
          id: "course-start",
          mode: "orientation",
          focusStatementId: "field-extension",
          entryMessages: [],
          hint: "Begin with the current outline item.",
        },
      },
      proof: {
        documentTitle: "Course notes",
        preamble: [
          "\\documentclass{article}",
          "\\usepackage{amsthm}",
          "\\newtheorem{definition}{Definition}",
          "\\newtheorem{theorem}[definition]{Theorem}",
          "\\begin{document}",
        ].join("\\n"),
        opening: "",
        fragments: {
          "legacy-note": {
            id: "legacy-note",
            label: "Legacy note",
            latex: LEGACY_SENTINEL,
          },
        },
        closing: "\\end{document}",
      },
    };

    function response(requestId, commands, intent = "proof_step") {
      return {
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        requestId,
        classification: {
          type: "classify_student_intent",
          intent,
          confidence: 1,
          rationale: "The student is developing the current item.",
        },
        commands,
      };
    }

    const write = (statementId = "field-extension", latex = generatedBody) => ({
      type: "write_course_note",
      statementId,
      latex,
      reason: "The conversation has established this entry.",
    });

    export function exercisePolicy() {
      const preview = buildInitializationPromptPreview(lesson, {
        profile: {
          name: lesson.settings.profile.name,
          personality: lesson.settings.profile.personality,
          customPrompts: lesson.settings.profile.customPrompts,
        },
        studentBackground: lesson.settings.studentBackgroundPrompt,
        curriculum: [{
          kind: "proposition",
          title: "Stale structural roadmap",
          statementLatex: LEGACY_SENTINEL,
        }],
      });
      const request = preview.request;
      const discussedRequest = {
        ...request,
        studentInput: {
          kind: "message",
          text: "The smaller field has the same operations inside the larger field.",
        },
      };
      const writtenRequest = {
        ...discussedRequest,
        lessonPlan: {
          ...discussedRequest.lessonPlan,
          writtenStatementIds: ["field-extension"],
        },
      };
      const selectedSentenceRequest = {
        ...discussedRequest,
        pinnedChoices: [{
          id: "field-inclusion-sentence",
          kind: "next_sentence",
          label: "$F\\subseteq K$ preserves field operations.",
        }],
        studentInput: {
          kind: "choice",
          text: "$F\\subseteq K$ preserves field operations.",
          selectedChoiceId: "field-inclusion-sentence",
        },
      };

      return {
        request,
        prompt: preview.prompt,
        generatedBody,
        legacySentinel: LEGACY_SENTINEL,
        validWrite: parseTutorResponse(
          response(request.requestId, [write()]),
          discussedRequest,
        ),
        sessionWrite: parseTutorResponse(
          response(request.requestId, [write()], "session_start"),
          request,
        ),
        futureWrite: parseTutorResponse(
          response(request.requestId, [write("degree")]),
          discussedRequest,
        ),
        duplicateWrite: parseTutorResponse(
          response(request.requestId, [write()]),
          writtenRequest,
        ),
        twoWrites: parseTutorResponse(
          response(request.requestId, [write(), write()]),
          discussedRequest,
        ),
        proofCommand: parseTutorResponse(
          response(request.requestId, [
            { type: "commit_latex", label: "Invented", latex: "Invented note." },
          ]),
          discussedRequest,
        ),
        selectedSentenceReply: parseTutorResponse(
          response(request.requestId, [{
            type: "reply",
            markdown: "Which vector-space structure does this inclusion give to $K$ over $F$?",
          }], "select_choice"),
          selectedSentenceRequest,
        ),
        advanceBeforeWrite: parseTutorResponse(
          response(request.requestId, [{
            type: "advance_roadmap",
            statementId: "degree",
            reason: "Move on.",
          }]),
          discussedRequest,
        ),
        writeThenAdvance: parseTutorResponse(
          response(request.requestId, [
            write(),
            {
              type: "advance_roadmap",
              statementId: "degree",
              reason: "The current entry is complete.",
            },
          ]),
          discussedRequest,
        ),
        unsafe: [
          "\\documentclass{article}",
          "\\usepackage{amsmath}",
          "\\begin{document}text\\end{document}",
          "\\def\\x{unsafe}",
          "\\edef\\x{unsafe}",
          "\\gdef\\x{unsafe}",
          "\\xdef\\x{unsafe}",
          "\\let\\x\\relax",
          "\\catcode64=11",
          "\\csname hidden\\endcsname",
          "\\special{unsafe}",
          "\\write16{unsafe}",
          "\\openout1=unsafe",
          "\\read1 to \\x",
          "\\input{elsewhere}",
          "\\include{elsewhere}",
          "<strong>raw HTML</strong>",
          "<img/>",
          "<svg/onload=alert(1)>",
          "Unmatched { brace",
          "\\begin{theorem}Nested wrapper.\\end{theorem}",
          "\\begin{enumerate}\\item Raw list.\\end{enumerate}",
          "\\begin{align}x&=y\\end{align}",
          "\\begin{cases}x&=y\\end{cases}",
          "$\\notARealKatexCommand{x}$",
        ].map((latex) => ({
          latex,
          direct: validateCourseNoteLatex(latex),
          parsed: parseTutorResponse(
            response(request.requestId, [write("field-extension", latex)]),
            discussedRequest,
          ),
        })),
        safe: [
          "A prose statement with $K/F$ and \\[ [K:F]=2. \\]",
          "\\begin{proof}Use the defining property.\\end{proof}",
          "\\[f(x)=\\begin{cases}x,&x>0,\\\\0,&x\\leq 0.\\end{cases}\\]",
        ].map((latex) => validateCourseNoteLatex(latex)),
        safeTitleBlocks: parseDocumentBlocks(
          "\\begin{document}\\n" +
            buildCourseNoteEntry(
              { kind: "definition", title: "$K$-embedding [relative]" },
              "A map that fixes $K$ pointwise.",
            ) +
            "\\n\\end{document}",
          false,
        ),
      };
    }

    export async function exerciseProvider() {
      const provider = new LocalCodexProvider(async (request) => {
        if (request.studentInput.kind === "session_start") {
          return response(request.requestId, [{
            type: "reply",
            markdown: "What structure must an inclusion $F\\subseteq K$ preserve?",
          }], "session_start");
        }
        return response(request.requestId, [
          write(),
          {
            type: "advance_roadmap",
            statementId: "degree",
            reason: "The field-extension entry has been established.",
          },
          {
            type: "reply",
            markdown: "Now regard $K$ as an $F$-vector space. What should its dimension measure?",
          },
        ]);
      });

      const started = await provider.createSession(lesson);
      const studentLine = "A student-edited observation remains here.";
      const studentSource = started.state.proof.editorLatex.replace(
        "\\end{document}",
        studentLine + "\\n\\n\\end{document}",
      );
      const rendered = await provider.dispatch(lesson, started.state, {
        type: "render-proof",
        latex: studentSource,
      });
      const result = await provider.dispatch(lesson, rendered.state, {
        type: "message",
        text: "The field operations agree, so the inclusion makes the larger field an algebra over the smaller one.",
      });

      const stale = {
        ...started.state,
        lessonContentVersion: 1,
      };
      return {
        accepted: result.accepted,
        generatedBody,
        source: result.state.proof.previewLatex,
        studentLine,
        writtenStatementIds: result.state.proof.courseNoteStatementIds,
        legacyFragmentIds: result.state.proof.fragmentIds,
        currentStatementId: result.state.currentStatementId,
        completedStatementIds: result.state.completedStatementIds,
        revision: result.state.proof.revision,
        blocks: parseDocumentBlocks(result.state.proof.previewLatex, false),
        staleRestorable: isRestorableLocalCodexSession(lesson, stale),
        currentRestorable: isRestorableLocalCodexSession(lesson, result.state),
      };
    }
  `;

  const result = await build({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "course-roadmap-provider-harness.ts",
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

test("course requests expose only the outline and omit legacy authored content", async () => {
  const result = (await loadHarness()).exercisePolicy();

  assert.deepEqual(Object.keys(result.request.theorem).sort(), ["id", "kind", "title"]);
  assert.ok(result.request.curriculum.every((item) => !("statementLatex" in item)));
  assert.deepEqual(
    result.request.curriculum.map((item) => item.title),
    ["Field extension", "Extension degree", "Tower law"],
  );
  assert.doesNotMatch(result.prompt, /Stale structural roadmap/);
  assert.ok(
    result.request.lessonPlan.roadmap.every(
      (item) => JSON.stringify(Object.keys(item).sort()) === JSON.stringify(["kind", "statementId", "title"]),
    ),
  );
  assert.doesNotMatch(result.prompt, new RegExp(result.legacySentinel));
  assert.match(result.prompt, /write_course_note/);
  assert.match(
    result.prompt,
    /latex is only the precise statement and proofLatex is only its proof/i,
  );
  assert.match(result.prompt, /Never put proof reasoning/i);
  assert.doesNotMatch(result.prompt, /commit_note_fragment/);
});

test("course policy permits one safe generated entry for only the current item", async () => {
  const result = (await loadHarness()).exercisePolicy();

  assert.equal(result.validWrite.ok, true);
  assert.equal(result.sessionWrite.ok, false);
  assert.equal(result.futureWrite.ok, false);
  assert.equal(result.duplicateWrite.ok, false);
  assert.equal(result.twoWrites.ok, false);
  assert.equal(result.proofCommand.ok, false);
  assert.equal(result.selectedSentenceReply.ok, true);
  for (const unsafe of result.unsafe) {
    assert.ok(unsafe.direct, unsafe.latex);
    assert.equal(unsafe.parsed.ok, false);
  }
  assert.deepEqual(result.safe, [null, null, null]);
  assert.deepEqual(
    result.safeTitleBlocks.find((block) => block.kind === "statement"),
    {
      kind: "statement",
      text: "Definition ($K$-embedding (relative))",
      environment: "definition",
    },
  );
});

test("roadmap advances only after the current generated entry exists", async () => {
  const result = (await loadHarness()).exercisePolicy();

  assert.equal(result.advanceBeforeWrite.ok, false);
  assert.equal(result.writeThenAdvance.ok, true);
});

test("provider appends generated notes without rebuilding or losing student edits", async () => {
  const result = await (await loadHarness()).exerciseProvider();

  assert.equal(result.accepted, true);
  assert.match(result.source, /\\begin\{definition\}/);
  assert.match(result.source, /\\begin\{definition\}\[field extension\]/);
  assert.ok(result.source.includes(result.generatedBody));
  assert.ok(result.source.includes(result.studentLine));
  assert.deepEqual(result.writtenStatementIds, ["field-extension"]);
  assert.deepEqual(result.legacyFragmentIds, []);
  assert.equal(result.currentStatementId, "degree");
  assert.deepEqual(result.completedStatementIds, ["field-extension"]);
  assert.ok(result.source.indexOf(result.generatedBody) < result.source.lastIndexOf("\\end{document}"));
  assert.ok(result.revision >= 2);
  assert.deepEqual(
    result.blocks.find((block) => block.kind === "statement"),
    {
      kind: "statement",
      text: "Definition (field extension)",
      environment: "definition",
    },
  );
  assert.ok(
    result.blocks.some(
      (block) => block.kind === "content" && block.text.includes("field extension"),
    ),
  );
});

test("course session restore rejects stale lesson content", async () => {
  const result = await (await loadHarness()).exerciseProvider();

  assert.equal(result.staleRestorable, false);
  assert.equal(result.currentRestorable, true);
});
