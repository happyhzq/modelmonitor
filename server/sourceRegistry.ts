import type { SourceStatus } from "./connectors/types";
import { status } from "./connectors/utils";

export function registryStatuses(): SourceStatus[] {
  return [
    status("aws-bedrock", "AWS Bedrock CloudWatch", "文件/导出接入", "pending", {
      message: "把 CloudWatch Invocations、InputTokenCount、OutputTokenCount 导出为 CSV/JSON 放入 data/sources",
      docs: "https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-cw.html",
    }),
    status("gcp-vertex", "Google Vertex / Gemini", "文件/账单接入", "pending", {
      message: "支持 Gemini response usageMetadata、Vertex 监控或 Cloud Billing BigQuery 导出",
      docs: "https://cloud.google.com/billing/docs/how-to/export-data-bigquery",
    }),
    status("otel-genai", "OpenTelemetry GenAI / Agent", "文件/API 接入", "pending", {
      message: "支持 gen_ai.usage.input_tokens、gen_ai.usage.output_tokens、agent trace 字段",
      docs: "https://opentelemetry.io/docs/specs/semconv/gen-ai/",
    }),
    status("langsmith-helicone", "LangSmith / Helicone", "HTTP/导出接入", "pending", {
      message: "可通过 MODEL_MONITOR_HTTP_JSON_SOURCES 或文件导出接入 request/trace token usage",
      docs: "https://docs.helicone.ai/",
    }),
    status("alibaba-dashscope", "Alibaba DashScope / BSS", "文件/账单接入", "pending", {
      message: "支持 DashScope 响应 usage、BSS 账单导出或网关日志",
      docs: "https://help.aliyun.com/zh/model-studio/use-qwen-by-calling-api",
    }),
    status("mistral-deepseek", "Mistral / DeepSeek", "文件/API 日志接入", "pending", {
      message: "响应内 usage 字段或网关日志可直接标准化接入",
    }),
  ];
}
