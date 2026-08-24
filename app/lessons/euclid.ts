import type { LessonDefinition } from "./types";

const ASSUMPTION = String.raw`Assume for contradiction that there are only finitely many primes, and list all of them as
\[
p_1,p_2,\ldots,p_n.
\]`;

const CONSTRUCTION = String.raw`Define
\[
N=p_1p_2\cdots p_n+1.
\]
Since the list contains $2$, we have $N>1$.`;

const NONDIVISIBILITY = String.raw`For every $i\in\{1,\ldots,n\}$, the product $p_1p_2\cdots p_n$ is divisible by $p_i$. Hence
\[
N\equiv 1\pmod{p_i},
\]
so $p_i\nmid N$.`;

const PRIME_DIVISOR = String.raw`Because $N>1$, it has a prime divisor; call one such divisor $q$.`;

const CONTRADICTION = String.raw`The prime $q$ cannot equal any $p_i$, since $q\mid N$ while no $p_i$ divides $N$. Thus $q$ is a prime absent from the supposedly complete list, a contradiction. Therefore there are infinitely many primes.`;

export const euclidLesson = {
  schemaVersion: 1,
  id: "euclid-infinitely-many-primes",
  title: "Euclid's theorem on prime numbers",
  contentFormat: "markdown-with-math",
  settings: {
    schemaVersion: 1,
    profile: {
      id: "patient-proof-guide",
      name: "AI Mathematician",
      personality:
        "Patient, exact, and Socratic. Ask one useful question at a time, reward precise reasoning, and point out missing logical bridges without revealing the complete proof too early.",
      customPrompts: [
        "Prefer guided questions to complete solutions.",
        "When a statement is vague, offer a few precise interpretations and let the student choose.",
        "Keep mathematical notation in LaTeX and explain why each proof step is valid.",
        "Suggest a change of strategy when the current path cannot establish the theorem.",
      ],
    },
    curriculum: [
      {
        id: "prime-divisor-lemma",
        kind: "lemma",
        title: "Existence of a prime divisor",
        statement: "Every integer greater than $1$ has a prime divisor.",
        latex: String.raw`\text{If }m>1,\text{ then some prime }q\text{ divides }m.`,
        backgroundNotes: [
          "A prime is an integer greater than $1$ whose positive divisors are $1$ and itself.",
        ],
      },
      {
        id: "euclid-primes",
        kind: "theorem",
        title: "Infinitude of primes",
        statement: "There are infinitely many prime numbers.",
        latex: String.raw`\#\{p\in\mathbb{N}:p\text{ is prime}\}=\infty`,
        backgroundNotes: [
          "The proof uses contradiction.",
          String.raw`If $a\mid b$, then $a$ divides every integer multiple of $b$.`,
        ],
      },
    ],
    studentBackgroundPrompt:
      "The student knows the definitions of prime, divisor, product, and remainder, but is still learning how contradiction proofs are assembled and how to state modular arguments precisely.",
  },
  targetStatementId: "euclid-primes",
  initialStepId: "choose-opening",
  proof: {
    documentTitle: "Euclid's theorem",
    preamble: String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amssymb}
\usepackage[margin=1in]{geometry}
\title{Euclid's Theorem}
\date{}
\begin{document}
\maketitle
\begin{theorem}
There are infinitely many prime numbers.
\end{theorem}`,
    opening: String.raw`\begin{proof}`,
    fragments: {
      assumption: {
        id: "assumption",
        label: "Contradiction assumption",
        latex: ASSUMPTION,
      },
      construction: {
        id: "construction",
        label: "Auxiliary number",
        latex: CONSTRUCTION,
      },
      nondivisibility: {
        id: "nondivisibility",
        label: "Remainder argument",
        latex: NONDIVISIBILITY,
      },
      "prime-divisor": {
        id: "prime-divisor",
        label: "Prime-divisor lemma",
        latex: PRIME_DIVISOR,
      },
      contradiction: {
        id: "contradiction",
        label: "Contradiction and conclusion",
        latex: CONTRADICTION,
      },
    },
    closing: String.raw`\end{proof}
\end{document}`,
  },
  steps: {
    "choose-opening": {
      id: "choose-opening",
      mode: "orientation",
      entryMessages: [
        "We will prove the theorem together without jumping straight to a finished solution. One fact from your background will matter later: every integer greater than $1$ has a prime divisor.",
        "How might we begin? Choose an opening, or ask me about any option before deciding.",
      ],
      choiceSet: {
        id: "opening-strategy",
        title: "Choose a proof opening",
        prompt: "Which general approach gives us something concrete to work with?",
        choices: [
          {
            id: "assume-finitely-many",
            label: "Assume only finitely many primes exist",
            studentMessage:
              "Let us assume for contradiction that only finitely many primes exist.",
            explanation:
              "This negates the theorem. If the assumption forces a prime outside a supposedly complete finite list, the contradiction proves the theorem.",
            freeTextMatches: [
              { all: ["assume", "finite"], none: ["largest"] },
              { all: ["suppose", "finitely"] },
              { all: ["contradiction", "finitely"] },
            ],
            outcome: {
              tutorMessages: [
                String.raw`Good. We are now in proof-creation mode. If there are only finitely many primes, we may list all of them as $p_1,\ldots,p_n$.`,
              ],
              addProofFragmentIds: ["assumption"],
              nextStepId: "construct-number",
            },
          },
          {
            id: "largest-prime",
            label: "Start with a largest prime",
            studentMessage: "Let $p$ be the largest prime.",
            explanation:
              "This is close to a contradiction approach, but a largest prime may be named only after we explicitly assume that the primes form a finite list.",
            freeTextMatches: [
              { all: ["largest", "prime"] },
              { all: ["greatest", "prime"] },
            ],
            outcome: {
              tutorMessages: [
                'You are anticipating the finite-list idea, but the phrase "largest prime" is not yet justified. First make the contradiction assumption that there are only finitely many primes.',
              ],
              markMistake: true,
              nextStepId: "choose-opening",
            },
          },
          {
            id: "induct-on-primes",
            label: "Induct on the number of primes",
            studentMessage: "Perhaps we can use induction on the number of primes.",
            explanation:
              "Induction needs a statement indexed by a natural number. Here, the number of all primes is exactly what we do not yet know to be finite, so this route does not supply a useful induction claim.",
            freeTextMatches: [{ any: ["induction", "induct"] }],
            outcome: {
              tutorMessages: [
                "There is no clear induction statement here: the number of primes is the unknown. Try a strategy that turns the theorem's negation into a finite object we can manipulate.",
              ],
              markMistake: true,
              nextStepId: "choose-opening",
            },
          },
        ],
      },
      hint:
        'Negate "there are infinitely many primes." What would the entire collection of primes look like under that assumption?',
    },
    "construct-number": {
      id: "construct-number",
      mode: "proof",
      entryMessages: [
        "Now construct a number related to every prime in the list. We want division by each $p_i$ to leave a controlled remainder.",
      ],
      choiceSet: {
        id: "number-construction",
        title: "Construct an auxiliary number",
        prompt: "Which construction is most useful?",
        choices: [
          {
            id: "product-plus-one",
            label: String.raw`$p_1p_2\cdots p_n+1$`,
            studentMessage: String.raw`Take $N=p_1p_2\cdots p_n+1$.`,
            explanation:
              "The product is divisible by every listed prime. Adding $1$ forces the remainder to be exactly $1$ after division by any $p_i$.",
            freeTextMatches: [
              { all: ["product", "plus 1"] },
              { all: ["multiply", "add 1"] },
              { all: ["p 1", "p n", "plus 1"] },
            ],
            outcome: {
              tutorMessages: [
                String.raw`Exactly. Let $N=p_1p_2\cdots p_n+1$. Why can no listed prime $p_i$ divide $N$? State the remainder calculation explicitly.`,
              ],
              addProofFragmentIds: ["construction"],
              nextStepId: "explain-nondivisibility",
            },
          },
          {
            id: "sum-of-primes",
            label: String.raw`$p_1+\cdots+p_n$`,
            studentMessage: String.raw`Take $N=p_1+\cdots+p_n$.`,
            explanation:
              "A sum does not give the same remainder for every listed prime. For example, one listed prime may divide the sum, so this construction does not separate $N$ from the full list.",
            freeTextMatches: [
              { all: ["sum", "prime"] },
              {
                all: ["p 1", "p n", "plus"],
                none: ["product", "multiply"],
              },
            ],
            outcome: {
              tutorMessages: [
                "The sum has no uniform remainder modulo each $p_i$. We need one expression that is divisible by every $p_i$ before making a small adjustment. Try a different strategy.",
              ],
              markMistake: true,
              nextStepId: "construct-number",
            },
          },
          {
            id: "bare-product",
            label: String.raw`$p_1p_2\cdots p_n$`,
            studentMessage: String.raw`Take $N=p_1p_2\cdots p_n$.`,
            explanation:
              "The bare product is divisible by every listed prime, so all of its prime divisors are already on the list. It cannot produce a new prime.",
            freeTextMatches: [
              { all: ["product"], none: ["plus 1", "add 1", "sum"] },
              {
                all: ["p 1", "p n"],
                none: ["plus 1", "add 1", "sum"],
              },
            ],
            outcome: {
              tutorMessages: [
                "That number is divisible by every $p_i$, which moves in the wrong direction. What tiny change to the product would make every division leave a nonzero remainder?",
              ],
              markMistake: true,
              nextStepId: "construct-number",
            },
          },
        ],
      },
      hint:
        "First make a number divisible by every $p_i$, then change it by the smallest positive amount.",
    },
    "explain-nondivisibility": {
      id: "explain-nondivisibility",
      mode: "proof",
      entryMessages: [],
      responseRules: [
        {
          id: "explicit-remainder",
          anyOf: [
            { all: ["remainder", "1"] },
            { all: ["equiv", "1", "mod"] },
            { all: ["multiple", "plus 1"] },
          ],
          outcome: {
            tutorMessages: [
              String.raw`Yes. Since $p_i$ divides the product, $N\equiv1\pmod{p_i}$, and therefore $p_i\nmid N$.`,
            ],
            addProofFragmentIds: ["nondivisibility"],
            nextStepId: "find-prime-divisor",
          },
        },
        {
          id: "skipped-logical-bridge",
          anyOf: [
            { any: ["contradiction", "new prime", "therefore prime"] },
          ],
          outcome: {
            tutorMessages: [
              "The proof checker sees a missing justification: before claiming a new prime or a contradiction, explain why division of $N$ by each $p_i$ leaves remainder $1$.",
            ],
            markMistake: true,
            nextStepId: "clarify-nondivisibility",
          },
        },
        {
          id: "vague-nondivisibility",
          anyOf: [
            { all: ["does not divide"] },
            { all: ["not divide"] },
            { all: ["nmid"] },
            { all: ["none", "divide"] },
          ],
          outcome: {
            tutorMessages: [
              String.raw`The proof checker found the missing justification: say that each $p_i$ divides the product, so dividing $N$ by $p_i$ leaves remainder $1$. Which precise sentence captures that?`,
            ],
            nextStepId: "clarify-nondivisibility",
          },
        },
      ],
      fallbackOutcome: {
        tutorMessages: [
          "Connect $N$ to the product modulo a particular $p_i$. Your explanation should name the remainder.",
        ],
        nextStepId: "clarify-nondivisibility",
      },
      hint:
        String.raw`Write $N=(p_1\cdots p_n)+1$. What is the remainder when the first term and then the whole expression are divided by $p_i$?`,
    },
    "clarify-nondivisibility": {
      id: "clarify-nondivisibility",
      mode: "proof",
      entryMessages: [],
      choiceSet: {
        id: "precise-remainder",
        title: "Make the step precise",
        prompt: "Which statement supplies the missing justification?",
        choices: [
          {
            id: "congruence-one",
            label: String.raw`$N\equiv1\pmod{p_i}$ for every $i$`,
            studentMessage:
              String.raw`Because $p_i$ divides the product, $N\equiv1\pmod{p_i}$ for every $i$.`,
            explanation:
              "This is the most compact precise version: divisibility of the product gives remainder $0$, and adding $1$ changes the remainder to $1$.",
            freeTextMatches: [
              { all: ["equiv", "1", "mod"] },
              { all: ["remainder", "1"] },
            ],
            outcome: {
              tutorMessages: [
                String.raw`Precisely. A nonzero remainder means $p_i\nmid N$ for every listed prime.`,
              ],
              addProofFragmentIds: ["nondivisibility"],
              nextStepId: "find-prime-divisor",
            },
          },
          {
            id: "quotient-remainder-one",
            label: "$N=p_i k+1$ for some integer $k$",
            studentMessage:
              String.raw`For each $i$, we can write $N=p_i k+1$ for an integer $k$, so $p_i\nmid N$.`,
            explanation:
              "This is the division-algorithm form of the same argument and is fully rigorous when $k$ is the product of all the other listed primes.",
            freeTextMatches: [
              { all: ["p i k plus 1"] },
              { all: ["quotient", "remainder 1"] },
            ],
            outcome: {
              tutorMessages: [
                "Good. This states the quotient and remainder directly, so the nondivisibility claim is justified.",
              ],
              addProofFragmentIds: ["nondivisibility"],
              nextStepId: "find-prime-divisor",
            },
          },
          {
            id: "product-not-divisible",
            label: "$p_i$ does not divide the product",
            studentMessage:
              String.raw`$p_i$ does not divide $p_1p_2\cdots p_n$.`,
            explanation:
              "This reverses a known fact: $p_i$ is one of the factors, so it certainly divides the product.",
            freeTextMatches: [
              { all: ["not divide", "product"] },
              { all: ["nmid", "product"] },
            ],
            outcome: {
              tutorMessages: [
                "Check the product itself: $p_i$ is one of its factors, so $p_i$ does divide it. The useful nonzero remainder appears only after adding $1$.",
              ],
              markMistake: true,
              nextStepId: "clarify-nondivisibility",
            },
          },
        ],
      },
      hint:
        "The product has remainder $0$ modulo $p_i$. Adding $1$ changes that remainder to what?",
    },
    "find-prime-divisor": {
      id: "find-prime-divisor",
      mode: "proof",
      entryMessages: [
        "We know no listed prime divides $N$, but we have not yet shown that some prime is connected to $N$. What logical bridge should come next?",
      ],
      choiceSet: {
        id: "prime-divisor-bridge",
        title: "Supply the logical bridge",
        prompt: "How do we obtain a prime to compare with the list?",
        choices: [
          {
            id: "use-prime-divisor-lemma",
            label: String.raw`Since $N>1$, choose a prime divisor $q\mid N$`,
            studentMessage:
              String.raw`Since $N>1$, the prime-divisor lemma gives a prime $q$ such that $q\mid N$.`,
            explanation:
              "This uses exactly the background lemma. We do not need $N$ itself to be prime; one of its prime divisors is enough.",
            freeTextMatches: [
              { all: ["prime divisor", "n"] },
              { all: ["q", "mid", "n"] },
              { all: ["q", "divides", "n"] },
            ],
            outcome: {
              tutorMessages: [
                String.raw`Exactly. The lemma guarantees a prime divisor $q$ even when $N$ is composite. Now compare $q$ with $p_1,\ldots,p_n$.`,
              ],
              addProofFragmentIds: ["prime-divisor"],
              nextStepId: "finish-contradiction",
            },
          },
          {
            id: "claim-n-prime",
            label: "Claim that $N$ itself is prime",
            studentMessage: "The number $N$ must be prime.",
            explanation:
              String.raw`The construction need not be prime. For the list $2,3,5,7,11,13$, the product plus one is $30031=59\cdot509$.`,
            freeTextMatches: [
              { all: ["n", "is prime"], none: ["divisor"] },
              { all: ["n", "must be prime"], none: ["divisor"] },
            ],
            outcome: {
              tutorMessages: [
                "That claim is too strong: a product of listed primes plus $1$ can be composite. We need only a prime divisor of $N$, which is guaranteed because $N>1$.",
              ],
              markMistake: true,
              nextStepId: "find-prime-divisor",
            },
          },
          {
            id: "factor-with-list",
            label: String.raw`Factor $N$ using only $p_1,\ldots,p_n$`,
            studentMessage:
              String.raw`Factor $N$ using only the primes $p_1,\ldots,p_n$.`,
            explanation:
              "That conflicts with the remainder argument: none of the listed primes divides $N$. Instead, let the prime-divisor lemma expose the conflict with completeness of the list.",
            freeTextMatches: [
              { all: ["factor", "listed"] },
              { all: ["factor", "p 1", "p n"] },
            ],
            outcome: {
              tutorMessages: [
                "None of those listed primes divides $N$, so they cannot supply its factorization. Use the general fact that every integer greater than $1$ has some prime divisor.",
              ],
              markMistake: true,
              nextStepId: "find-prime-divisor",
            },
          },
        ],
      },
      hint:
        "Recall the fact from the start of the lesson: every integer greater than $1$ has what kind of divisor?",
    },
    "finish-contradiction": {
      id: "finish-contradiction",
      mode: "proof",
      entryMessages: [
        "Which final comparison creates the contradiction?",
      ],
      choiceSet: {
        id: "final-comparison",
        title: "Finish the contradiction",
        prompt: "What must be true of the prime divisor $q$?",
        choices: [
          {
            id: "q-not-listed",
            label: "$q$ is not any $p_i$",
            studentMessage:
              String.raw`The prime $q$ is not equal to any $p_i$, because $q\mid N$ but every $p_i\nmid N$.`,
            explanation:
              "If $q$ equaled some listed prime $p_i$, that $p_i$ would divide $N$, contradicting the remainder calculation.",
            freeTextMatches: [
              { all: ["q", "not", "p i"] },
              { all: ["q", "outside", "list"] },
              { all: ["new", "prime"] },
            ],
            outcome: {
              tutorMessages: [
                "Complete. We have found a prime outside a list that was assumed to contain every prime. That contradiction proves there are infinitely many primes.",
              ],
              addProofFragmentIds: ["contradiction"],
              complete: true,
            },
          },
          {
            id: "q-is-listed",
            label: "$q$ must equal one of the $p_i$",
            studentMessage: "The prime $q$ must equal one of the $p_i$.",
            explanation:
              String.raw`That is what the finite-list assumption predicts, but it conflicts with $q\mid N$ and the established fact that no $p_i$ divides $N$.`,
            freeTextMatches: [
              { all: ["q", "listed"], none: ["not", "outside"] },
              { all: ["q", "equal", "p i"], none: ["not"] },
            ],
            outcome: {
              tutorMessages: [
                "The assumption says $q$ should be listed, but our remainder calculation says no listed prime divides $N$. State that conflict explicitly to finish the proof.",
              ],
              markMistake: true,
              nextStepId: "finish-contradiction",
            },
          },
          {
            id: "n-no-prime-factor",
            label: "$N$ has no prime divisor",
            studentMessage: "$N$ has no prime divisor.",
            explanation:
              "This contradicts the prime-divisor lemma and is not what the remainder calculation shows. The calculation excludes only the primes on the assumed list.",
            freeTextMatches: [
              { all: ["n", "no prime divisor"] },
              { all: ["n", "has no", "prime"] },
            ],
            outcome: {
              tutorMessages: [
                String.raw`Careful: we proved only that no listed $p_i$ divides $N$. The prime-divisor lemma still gives $q\mid N$, so $q$ must be outside the list.`,
              ],
              markMistake: true,
              nextStepId: "finish-contradiction",
            },
          },
        ],
      },
      hint:
        String.raw`If $q$ equaled some $p_i$, combine $q\mid N$ with what you already proved about $p_i$ and $N$.`,
    },
  },
} satisfies LessonDefinition;
