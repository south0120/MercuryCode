import type { Tool } from "./index.js";
import type { Skill } from "../skills.js";

export function makeInvokeSkillTool(skills: Skill[]): Tool {
  return {
    name: "invoke_skill",
    description:
      "Load the detailed instructions of a registered skill by name. Use when the user task matches a skill's described purpose. The returned content is YOUR new guidance for the rest of the turn — follow it.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Skill name (one of the registered skills listed in the system prompt).",
        },
      },
      required: ["name"],
    },
    describe(args) {
      return `invoke_skill ${args.name}`;
    },
    async run(args) {
      const wanted = String(args.name ?? "").trim();
      const skill = skills.find((s) => s.name === wanted);
      if (!skill) {
        return { error: `unknown skill: ${wanted}`, available: skills.map((s) => s.name) };
      }
      return {
        name: skill.name,
        source: skill.source,
        instructions: skill.body,
      };
    },
  };
}
