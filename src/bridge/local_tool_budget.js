"use strict";

function createToolCallBudget(maxToolCalls) {
  if (maxToolCalls == null) return null;
  const value = Number(maxToolCalls);
  if (!Number.isInteger(value) || value < 0) {
    const error = new Error("max_tool_calls must be a non-negative integer");
    error.status = 400;
    error.code = "invalid_max_tool_calls";
    error.param = "max_tool_calls";
    throw error;
  }
  return {
    limit: value,
    used: 0,
    skipped: 0,
    skipped_calls: [],
  };
}

function reserveToolCall(budget, descriptor = {}) {
  if (!budget) return true;
  if (budget.used < budget.limit) {
    budget.used += 1;
    return true;
  }
  budget.skipped += 1;
  if (budget.skipped_calls.length < 20) {
    budget.skipped_calls.push({
      ...descriptor,
      reason: "max_tool_calls_exhausted",
    });
  }
  return false;
}

function toolBudgetCompatibility(budget) {
  if (!budget) return {};
  return {
    local_tool_budget: {
      max_tool_calls: budget.limit,
      used: budget.used,
      skipped: budget.skipped,
      exhausted: budget.used >= budget.limit,
      ...(budget.skipped_calls.length ? { skipped_calls: budget.skipped_calls } : {}),
    },
  };
}

module.exports = {
  createToolCallBudget,
  reserveToolCall,
  toolBudgetCompatibility,
};
