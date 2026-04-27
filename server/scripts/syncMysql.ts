import { loadEnv } from "../env";
import { buildTelemetry } from "../aggregate";

loadEnv();

const days = Number(process.env.MODEL_MONITOR_SYNC_DAYS || 90);
const telemetry = await buildTelemetry(days);

console.log(
  JSON.stringify(
    {
      sourceMode: telemetry.sourceMode,
      modelRecords: telemetry.modelUsageRecords.length,
      agentRecords: telemetry.agentUsageRecords.length,
      mysql: telemetry.sourceReadiness.filter((item) => item.id === "mysql" || item.id === "mysql-read"),
    },
    null,
    2,
  ),
);
