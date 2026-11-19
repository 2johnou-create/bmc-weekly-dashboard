const stagePattern = /^(?:capture|authenticate|browser_launch|browser_context|cleanup|inventory(?:_retry)?(?:_legacy)?|previous_output|previous_cost|lab_loss|lab_blend_(?:liberty|rhythm)|lab_profile_group_\d{1,2}|lab_profile_input_\d{1,2}|lab_consumption_month_[0-2]|weekly_production_(?:before|after)|weekly_schedule(?:_verify)?_(?:[0-4]|week)|weekly_roasted_cost|green_marrickville|weekly_monday)$/;
const states = new Set(["running", "complete", "failed", "retry"]);
const phases = new Set(["open", "navigate", "ready", "filters", "pagination", "parse", "close", "deadline"]);

export function safeProgress(input, now = () => new Date()) {
  if (!input || !stagePattern.test(input.stage) || !states.has(input.state) || !phases.has(input.phase)) return null;
  const event = { stage: input.stage, state: input.state, phase: input.phase, at: now().toISOString() };
  if (typeof input.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(input.code)) event.code = input.code;
  if (input.diagnostics && typeof input.diagnostics === "object") {
    const flags = {};
    for (const key of ["sameOrigin", "passwordInput", "expectedBody", "expectedHeaders", "pager", "emptySchedule", "challenge", "accessDenied", "inspectionTimedOut"]) {
      if (typeof input.diagnostics[key] === "boolean") flags[key] = input.diagnostics[key];
    }
    if (["login", "expected", "other"].includes(input.diagnostics.urlClass)) flags.urlClass = input.diagnostics.urlClass;
    if (["loading", "interactive", "complete"].includes(input.diagnostics.readyState)) flags.readyState = input.diagnostics.readyState;
    for (const key of ["tableCount", "loadingCount", "errorPanelCount", "pageErrorCount", "failedScriptCount"]) {
      if (Number.isInteger(input.diagnostics[key]) && input.diagnostics[key] >= 0 && input.diagnostics[key] <= 30) flags[key] = input.diagnostics[key];
    }
    if (Object.keys(flags).length) event.diagnostics = flags;
  }
  return event;
}

export function browserFailureCode(error) {
  if (error?.name === "ReaderError" && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)) return error.code;
  return error?.name === "TimeoutError" ? "CROPSTER_VIEW_TIMEOUT" : "CROPSTER_UNAVAILABLE";
}
