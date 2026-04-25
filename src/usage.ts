// Mercury 2 pricing (USD per token), as of model catalog reading:
// prompt: $0.00000025, completion: $0.00000075
const PROMPT_USD_PER_TOKEN = 0.00000025;
const COMPLETION_USD_PER_TOKEN = 0.00000075;

export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalRequests: number;
}

export function newUsage(): UsageTotals {
  return { promptTokens: 0, completionTokens: 0, totalRequests: 0 };
}

export function add(
  totals: UsageTotals,
  prompt: number | undefined,
  completion: number | undefined,
) {
  if (typeof prompt === "number") totals.promptTokens += prompt;
  if (typeof completion === "number") totals.completionTokens += completion;
  totals.totalRequests += 1;
}

export function costUSD(totals: UsageTotals): number {
  return (
    totals.promptTokens * PROMPT_USD_PER_TOKEN +
    totals.completionTokens * COMPLETION_USD_PER_TOKEN
  );
}

export function summary(totals: UsageTotals): string {
  const total = totals.promptTokens + totals.completionTokens;
  const cost = costUSD(totals);
  return [
    `requests:    ${totals.totalRequests}`,
    `prompt tok:  ${totals.promptTokens.toLocaleString()}`,
    `output tok:  ${totals.completionTokens.toLocaleString()}`,
    `total tok:   ${total.toLocaleString()}`,
    `est. cost:   $${cost.toFixed(6)} USD`,
  ].join("\n");
}
