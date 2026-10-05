const [healthUrl, expectedCommit] = process.argv.slice(2);
if (!healthUrl || !/^[0-9a-f]{40}$/.test(expectedCommit || "")) {
  throw new Error("Usage: verify-production-health.mjs <health-url> <expected-commit-sha>");
}

let lastError;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const response = await fetch(healthUrl, {
      headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`);
    const health = await response.json();
    if (health?.ok !== true || health?.service !== "claritude") {
      throw new Error("Health endpoint did not report a healthy Claritude service.");
    }
    if (health?.deployment?.commitSha !== expectedCommit) {
      throw new Error(`Production reports commit ${health?.deployment?.commitSha || "unavailable"}; expected ${expectedCommit}.`);
    }
    console.log(JSON.stringify({
      ok: health.ok,
      service: health.service,
      deploymentCommit: health.deployment.commitSha,
      architectureVersion: health.audit?.architectureVersion,
      implementedChecks: health.audit?.implementedChecks,
    }));
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

throw lastError || new Error("Production health verification failed.");
