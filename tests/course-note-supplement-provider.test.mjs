import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

async function loadHarness() {
  const source = String.raw`
    import { galoisLesson } from "./app/lessons/galois.ts";
    import { LocalCodexProvider } from "./app/providers/local-codex.ts";
    import {
      TUTOR_PROTOCOL_VERSION,
      buildCourseNoteEntry,
    } from "./app/protocol/index.ts";

    const bodies = {
      "field-extension": "A \\emph{field extension} $L/K$ is an inclusion of fields $K\\subseteq L$.",
      "algebraic-element": "An \\emph{algebraic element} $\\alpha\\in L$ over $K$ is one for which some nonzero $f\\in K[x]$ satisfies $f(\\alpha)=0$.",
      "minimal-polynomial": "The \\emph{minimal polynomial} of an algebraic element $\\alpha$ over $K$ is the monic polynomial of least positive degree in $K[x]$ that vanishes at $\\alpha$.",
    };
    const noteId = "minimal-polynomial-uniqueness";
    const supplement = {
      kind: "lemma",
      title: "Uniqueness of the minimal polynomial",
      latex: "The minimal polynomial of an algebraic element over $K$ is unique.",
      proofLatex: "If monic polynomials $p,q\\in K[x]$ of least positive degree both vanish at $\\alpha$, division gives $p=aq+r$ with $\\deg r<\\deg q$. Evaluating at $\\alpha$ gives $r(\\alpha)=0$, so minimality forces $r=0$. Thus $q$ divides $p$; equal degree and monicity give $p=q$.",
    };
    const secondNoteId = "minimal-polynomial-divisibility";
    const secondSupplement = {
      kind: "proposition",
      title: "Minimal polynomials divide annihilating polynomials",
      latex: "If $f\\in K[x]$ satisfies $f(\\alpha)=0$, then the minimal polynomial of $\\alpha$ divides $f$.",
      proofLatex: "Divide $f$ by the minimal polynomial $m$ to write $f=qm+r$ with $\\deg r<\\deg m$. Since $f(\\alpha)=m(\\alpha)=0$, also $r(\\alpha)=0$; minimality of $m$ forces $r=0$.",
    };
    const roadmapDuplicate = {
      kind: "lemma",
      title: "Images of algebraic elements under embeddings",
      latex: "A duplicate of a later roadmap result.",
      proofLatex: "This should never be inserted early.",
    };

    function response(request, commands, intent = "proof_step") {
      return {
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        requestId: request.requestId,
        classification: {
          type: "classify_student_intent",
          intent,
          confidence: 1,
          rationale: "Deterministic supplementary-note fixture.",
        },
        commands,
      };
    }

    function transport(request) {
      if (request.studentInput.kind === "session_start") {
        return response(request, [{
          type: "reply",
          markdown: "How should we begin with field extensions?",
        }], "session_start");
      }

      const current = request.lessonPlan.currentStatementId;
      if (!request.lessonPlan.writtenStatementIds.includes(current)) {
        return response(request, [{
          type: "write_course_note",
          statementId: current,
          latex: bodies[current],
          reason: "The current definition has been established.",
        }]);
      }

      if (request.studentInput.text.toLowerCase().includes("continue")) {
        const index = request.lessonPlan.roadmap.findIndex(
          (item) => item.statementId === current,
        );
        return response(request, [{
          type: "advance_roadmap",
          statementId: request.lessonPlan.roadmap[index + 1].statementId,
          reason: "The student is ready for the next definition.",
        }]);
      }

      const wantsDivisibility = request.studentInput.text
        .toLowerCase()
        .includes("divisibility");
      const wantsNewIdentity = request.studentInput.text
        .toLowerCase()
        .includes("new identity");
      const wantsRoadmapDuplicate = request.studentInput.text
        .toLowerCase()
        .includes("roadmap duplicate");
      return response(request, [{
        type: "insert_course_note_supplement",
        noteId: wantsRoadmapDuplicate
          ? "future-roadmap-duplicate"
          : wantsDivisibility
          ? secondNoteId
          : wantsNewIdentity
            ? noteId + "-duplicate"
            : noteId,
        afterStatementId: "minimal-polynomial",
        ...(wantsRoadmapDuplicate
          ? roadmapDuplicate
          : wantsDivisibility
            ? secondSupplement
            : supplement),
        reason: "The student explicitly requested the uniqueness result as a lemma.",
      }], "edit_proof");
    }

    export async function exerciseSupplement() {
      const provider = new LocalCodexProvider(transport);
      let result = await provider.createSession(galoisLesson);
      result = await provider.dispatch(galoisLesson, result.state, {
        type: "message",
        text: "Use the field-extension definition we established.",
      });
      result = await provider.dispatch(galoisLesson, result.state, {
        type: "message",
        text: "Continue to the next topic.",
      });
      result = await provider.dispatch(galoisLesson, result.state, {
        type: "message",
        text: "Use the definition of an algebraic element we established.",
      });
      result = await provider.dispatch(galoisLesson, result.state, {
        type: "message",
        text: "Continue to the next topic.",
      });
      result = await provider.dispatch(galoisLesson, result.state, {
        type: "message",
        text: "Use the definition of minimal polynomial we established.",
      });

      const before = result.state;
      const rejectedRoadmapDuplicate = await provider.dispatch(
        galoisLesson,
        before,
        {
          type: "message",
          text: "Insert this roadmap duplicate as a lemma in the course notes.",
        },
      );
      const inserted = await provider.dispatch(galoisLesson, before, {
        type: "message",
        text: "Please insert this as a lemma in the course notes: the minimal polynomial of an algebraic element is unique, with the proof we discussed.",
      });
      const duplicate = await provider.dispatch(galoisLesson, inserted.state, {
        type: "message",
        text: "Please insert this again as a lemma in the course notes with a new identity: the minimal polynomial is unique.",
      });
      const second = await provider.dispatch(galoisLesson, inserted.state, {
        type: "message",
        text: "Please insert the divisibility result as a proposition in the course notes, with its proof.",
      });
      return {
        before,
        rejectedRoadmapDuplicate,
        inserted,
        duplicate,
        second,
        entry: buildCourseNoteEntry(supplement, supplement.latex, supplement.proofLatex),
        noteId,
        secondNoteId,
        secondEntry: buildCourseNoteEntry(
          secondSupplement,
          secondSupplement.latex,
          secondSupplement.proofLatex,
        ),
      };
    }
  `;

  const result = await build({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "course-note-supplement-provider-harness.ts",
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

test("an explicitly requested lemma is inserted after the current generated entry", async () => {
  const { before, inserted, entry, noteId } =
    await (await loadHarness()).exerciseSupplement();

  assert.equal(inserted.accepted, true, JSON.stringify(inserted));
  assert.equal(
    inserted.state.proof.editorLatex.replace(`${entry}\n\n`, ""),
    before.proof.editorLatex,
  );
  assert.ok(
    inserted.state.proof.editorLatex.indexOf(entry) >
      inserted.state.proof.editorLatex.indexOf(
        "\\begin{definition}[minimal polynomial]",
      ),
  );
  assert.ok(
    inserted.state.proof.editorLatex.indexOf(entry) <
      inserted.state.proof.editorLatex.indexOf("\\end{document}"),
  );
  assert.match(entry, /\\begin\{lemma\}\[Uniqueness of the minimal polynomial\]/);
  assert.match(entry, /\\end\{lemma\}\n\n\\begin\{proof\}/);
  assert.equal(inserted.state.currentStatementId, before.currentStatementId);
  assert.deepEqual(
    inserted.state.completedStatementIds,
    before.completedStatementIds,
  );
  assert.deepEqual(
    inserted.state.proof.courseNoteStatementIds,
    before.proof.courseNoteStatementIds,
  );
  assert.deepEqual(inserted.state.proof.courseNoteSupplementIds, [noteId]);
  assert.equal(inserted.state.proof.revision, before.proof.revision + 1);
  assert.equal(inserted.state.proof.previewLatex, inserted.state.proof.editorLatex);
  assert.equal(inserted.state.proof.reviewedLatex, inserted.state.proof.editorLatex);
});

test("a repeated supplementary note id cannot duplicate the inserted lemma", async () => {
  const { inserted, duplicate, entry } =
    await (await loadHarness()).exerciseSupplement();

  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.state.proof.editorLatex, inserted.state.proof.editorLatex);
  assert.equal(duplicate.state.proof.editorLatex.split(entry).length - 1, 1);
  assert.match(
    duplicate.state.messages.findLast((message) => message.kind === "error")
      ?.markdown ?? "",
    /could not be inserted safely/i,
  );
});

test("multiple supplements after one topic retain chronological order", async () => {
  const { inserted, second, entry, secondEntry, noteId, secondNoteId } =
    await (await loadHarness()).exerciseSupplement();

  assert.equal(second.accepted, true, JSON.stringify(second));
  const source = second.state.proof.editorLatex;
  assert.ok(source.indexOf(entry) < source.indexOf(secondEntry));
  assert.ok(source.indexOf(secondEntry) < source.indexOf("\\end{document}"));
  assert.deepEqual(second.state.proof.courseNoteSupplementIds, [
    noteId,
    secondNoteId,
  ]);
  assert.equal(second.state.currentStatementId, inserted.state.currentStatementId);
  assert.deepEqual(
    second.state.completedStatementIds,
    inserted.state.completedStatementIds,
  );
  assert.deepEqual(
    second.state.proof.courseNoteStatementIds,
    inserted.state.proof.courseNoteStatementIds,
  );
});

test("a supplement cannot duplicate a named roadmap result", async () => {
  const { before, rejectedRoadmapDuplicate } =
    await (await loadHarness()).exerciseSupplement();

  assert.equal(rejectedRoadmapDuplicate.accepted, false);
  assert.equal(
    rejectedRoadmapDuplicate.state.proof.editorLatex,
    before.proof.editorLatex,
  );
  assert.deepEqual(
    rejectedRoadmapDuplicate.state.proof.courseNoteStatementIds,
    before.proof.courseNoteStatementIds,
  );
  assert.equal(
    rejectedRoadmapDuplicate.state.proof.courseNoteSupplementIds,
    undefined,
  );
});
