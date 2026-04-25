import prompts from "prompts";
import chalk from "chalk";
import { ui } from "./ui.js";

export interface ApprovalState {
  yolo: boolean;
  alwaysApprove: Set<string>;
  rejected: Set<string>;
}

export function makeApprovalState(yolo: boolean): ApprovalState {
  return { yolo, alwaysApprove: new Set(), rejected: new Set() };
}

export async function confirmAction(
  state: ApprovalState,
  toolName: string,
  detail: string,
): Promise<"approve" | "reject"> {
  if (state.yolo) return "approve";
  if (state.alwaysApprove.has(toolName)) return "approve";

  ui.approvalBox(toolName, detail);

  const { action } = await prompts({
    type: "select",
    name: "action",
    message: chalk.bold("Allow this action?"),
    choices: [
      { title: chalk.green("✔ Yes, once"), value: "yes" },
      { title: chalk.green("✔ Yes, always for ") + chalk.bold(toolName), value: "always" },
      { title: chalk.red("✘ No, reject"), value: "no" },
    ],
    initial: 0,
  });

  if (action === "always") {
    state.alwaysApprove.add(toolName);
    return "approve";
  }
  if (action === "yes") return "approve";
  return "reject";
}
