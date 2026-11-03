import type {
  AnswerExtraction,
  ExperienceDB,
  Gap,
  JDAnalysis,
  MatchOutput,
  ParsedCV,
  Requirement,
  RewriteOutput,
} from "./schema";
import { FACT_FIELDS } from "./schema";

// Canned stand-ins used when no API key is configured. They only know the bundled sample CV/JD.

export function mockParseCV(): ParsedCV {
  return {
    education: [
      {
        school: "University of Michigan",
        degree: "M.S.",
        field: "Biostatistics",
        location: null,
        start_date: null,
        end_date: "expected 2027",
        gpa: null,
        details: [],
      },
    ],
    affiliations: [
      {
        organization: "Department of Biostatistics, University of Michigan",
        title: "Graduate Research Assistant",
        type: "research",
        start_date: "Sep 2025",
        end_date: "Present",
        cards: [
          {
            name: "30-day readmission prediction",
            original_bullet_ids: ["cvb6", "cvb7", "cvb8", "cvb9"],
            my_role: "Graduate Research Assistant",
            context: ["Predict 30-day readmission from patient records"],
            my_actions: [
              "Built logistic regression models in Python",
              "Cleaned and merged EHR data from 3 sources, handling missing values",
              "Presented weekly results to a faculty advisor",
            ],
            team_actions: [],
            methods: ["logistic regression"],
            tools: ["Python"],
            skills: [],
            scale: ["12,000 patient records", "3 data sources"],
            outcomes: [
              { note: "AUC on held-out data", value: 0.81, unit: "AUC", basis: "held-out set" },
            ],
          },
        ],
      },
      {
        organization: "BIOSTAT 699",
        title: "Course Project: Hospital Database",
        type: "course_project",
        start_date: "Fall 2025",
        end_date: null,
        cards: [
          {
            name: "Hospital scheduling database",
            original_bullet_ids: ["cvb12", "cvb13"],
            my_role: null,
            context: ["Relational database for hospital scheduling"],
            my_actions: ["Wrote queries for the project"],
            team_actions: ["Worked in a 4-person team to design the database"],
            methods: [],
            tools: ["SQL"],
            skills: [],
            scale: [],
            outcomes: [],
          },
        ],
      },
      {
        organization: "Intro to Statistics",
        title: "Teaching Assistant",
        type: "teaching",
        start_date: "Jan 2026",
        end_date: "Apr 2026",
        cards: [
          {
            name: "Intro to Statistics TA",
            original_bullet_ids: ["cvb16", "cvb17"],
            my_role: "Teaching Assistant",
            context: [],
            my_actions: [
              "Held weekly office hours",
              "Graded homework and explained hypothesis testing concepts",
            ],
            team_actions: [],
            methods: [],
            tools: [],
            skills: [],
            scale: ["40 students"],
            outcomes: [],
          },
        ],
      },
      {
        organization: "Skills (from CV)",
        title: null,
        type: "skills_list",
        start_date: null,
        end_date: null,
        cards: [
          {
            name: "Skills listed on CV",
            original_bullet_ids: [],
            my_role: null,
            context: [],
            my_actions: [],
            team_actions: [],
            methods: [],
            tools: [],
            skills: ["Python (pandas, scikit-learn)", "R", "SQL", "LaTeX"],
            scale: [],
            outcomes: [],
          },
        ],
      },
    ],
  };
}

export function mockAnalyzeJD(): JDAnalysis {
  return {
    role_title: "Data Analyst (early-stage startup)",
    domain: "Product / user analytics",
    seniority: "Entry level",
    requirements: [
      { id: "r1", text: "Strong SQL", kind: "must_have", priority: "high", keywords: ["sql", "query", "queries", "database"] },
      { id: "r2", text: "Python for data analysis", kind: "must_have", priority: "high", keywords: ["python", "pandas"] },
      { id: "r3", text: "Dashboards / BI tools such as Tableau", kind: "must_have", priority: "medium", keywords: ["tableau", "dashboard", "power bi", "looker"] },
      { id: "r4", text: "Design and evaluate A/B tests; experimentation", kind: "must_have", priority: "medium", keywords: ["a/b", "experiment", "hypothesis"] },
      { id: "r5", text: "Statistics", kind: "must_have", priority: "medium", keywords: ["statistic", "regression", "logistic", "hypothesis"] },
      { id: "r6", text: "Explain findings to non-technical stakeholders", kind: "responsibility", priority: "medium", keywords: ["present", "explain", "stakeholder", "communicat"] },
    ],
  };
}

export function mockMatch(db: ExperienceDB, jd: JDAnalysis): MatchOutput {
  return {
    matches: jd.requirements.map((r) => {
      const evidence = new Set<string>();
      const related = new Set<string>();
      for (const card of db.cards) {
        let cardHit = false;
        for (const field of FACT_FIELDS) {
          for (const f of card[field]) {
            if (r.keywords.some((k) => f.text.toLowerCase().includes(k))) {
              evidence.add(f.id);
              related.add(card.id);
              cardHit = true;
            }
          }
        }
        for (const o of card.outcomes) {
          if (r.keywords.some((k) => o.note.toLowerCase().includes(k))) {
            evidence.add(o.id);
            related.add(card.id);
            cardHit = true;
          }
        }
        if (cardHit && (card.tools.length || card.methods.length)) {
          for (const a of card.my_actions) evidence.add(a.id);
        }
      }
      return {
        requirement_id: r.id,
        evidence_fact_ids: [...evidence],
        related_card_ids: [...related],
        note: "keyword match (mock mode)",
      };
    }),
  };
}

export function mockQuestion(gap: Gap, req: Requirement): string {
  if (gap.status === "weak") {
    return `JD 要求「${req.text}」。你的经历库里有相关内容，但细节不够。能具体说说你在这件事里实际做了什么、用了哪些方法或工具、最后有没有可以量化的结果吗？`;
  }
  return `JD 要求「${req.text}」。你有没有做过相关的事情（课程、项目、实习、科研都算）？如果有，请说说你具体做了什么；如果没有，直接回答"没有"就可以。`;
}

export function mockExtract(
  answer: string,
  gap: Gap,
): AnswerExtraction {
  const none = /^\s*(没有|没做过|无|没用过|no\b|none|not really)/i.test(answer.trim());
  if (none) {
    return { has_experience: false, target_card_id: null, new_card_name: null, new_facts: [], new_outcomes: [] };
  }
  const numbers = [...answer.matchAll(/(\d+(?:\.\d+)?)\s*(%|倍|人|个|次|小时|天)?/g)];
  const outcomes = numbers.slice(0, 2).map((m) => ({
    note: answer.slice(Math.max(0, (m.index ?? 0) - 12), (m.index ?? 0) + m[0].length + 8).trim(),
    value: Number(m[1]),
    unit: m[2] ?? null,
    basis: null,
  }));
  return {
    has_experience: true,
    target_card_id: gap.related_card_ids[0] ?? null,
    new_card_name: gap.related_card_ids[0] ? null : "Experience added in interview",
    new_facts: [{ field: "my_actions", text: answer.trim() }],
    new_outcomes: outcomes,
  };
}

export function mockRewrite(db: ExperienceDB, cardIds: string[]): RewriteOutput {
  return {
    cards: cardIds.flatMap((id) => {
      const card = db.cards.find((c) => c.id === id);
      if (!card) return [];
      const bullets = [
        ...(card.original_bullets ?? []).map((b) => ({ original_bullet_id: b.id,
          text: b.text.replace(/^Built /, "Developed ").replace(/^Wrote /, "Authored "), source_ids: [b.id] })),
        ...card.my_actions.filter((a) => a.status === "user_confirmed" && a.source === "dialogue")
          .map((a) => ({ original_bullet_id: null, text: a.text, source_ids: [a.id] })),
      ];
      return [{ card_id: card.id, bullets }];
    }),
  };
}
