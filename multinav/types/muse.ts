export type MuseEvent = {
  event_id?: string;
  session_id: string;
  ts?: string;

  user_input: { text: string; tags?: string[]; attachments?: string[] };
  task_context?: { topic?: string; intent?: string; difficulty?: string; priority?: string };

  client?: { surface?: string; pane_id?: string; browser?: string; os?: string; device?: string };

  model: { provider: string; name: string; mode?: string; context_tokens?: number; temperature?: number };

  response: { text?: string; raw_tokens?: number; finish_reason?: string; latency_ms?: number };

  observations?: { contains_code?: boolean; has_citations?: boolean; ui_broke?: boolean };

  labels?: { quality?: string | null; actionable?: boolean | null; hallucination_flag?: boolean | null; kept?: boolean | null };
  metrics?: { score_overall?: number | null; score_accuracy?: number | null; score_style?: number | null; score_speed?: number | null };
  costing?: { input_tokens?: number; output_tokens?: number; usd_estimate?: number };

  links?: { source_urls?: string[]; attachments_saved?: string[] };
};
