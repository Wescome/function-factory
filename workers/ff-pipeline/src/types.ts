export interface PipelineConfig {
  name: string;
  steps: PipelineStep[];
}

export interface PipelineStep {
  id: string;
  type: string;
}

export interface PipelineResult {
  success: boolean;
  output?: unknown;
  error?: string;
  factoryVersion?: string;
}
